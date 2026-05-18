export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const rawBody = await req.json();
        const apiKey = process.env.GEMINI_API_KEY;

        // 1. Gemini format ko Groq format mein convert karo
        const messages = rawBody.contents ? rawBody.contents.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: c.parts[0].text
        })) : (rawBody.messages || []);

        // 2. Groq API Call (Llama 3.1 100% Active Model)
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: messages,
                stream: true
            })
        });

        if (!response.ok) {
            const err = await response.text();
            return new Response(err, { status: response.status });
        }

        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        
        // 🔥 BUFFER ENGINE: Yeh adhe-adhure shabdon ko aapas mein jode rakhega
        let leftover = ''; 

        const transformStream = new TransformStream({
            transform(chunk, controller) {
                const text = decoder.decode(chunk, { stream: true });
                const lines = (leftover + text).split('\n');
                
                // Sabse aakhiri adhi-adhuri line ko bacha kar agle chunk ke liye rakho
                leftover = lines.pop() || ''; 
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const jsonStr = trimmed.slice(6);
                            const parsed = JSON.parse(jsonStr);
                            const content = parsed.choices?.[0]?.delta?.content;
                            
                            if (content) {
                                // Ekdam pure Gemini compatible chunk format
                                const geminiChunk = {
                                    candidates: [{
                                        content: {
                                            parts: [{ text: content }]
                                        }
                                    }]
                                };
                                controller.enqueue(encoder.encode(JSON.stringify(geminiChunk) + '\n'));
                            }
                        } catch (e) {
                            // Agar abhi bhi koi incomplete line ho toh skip karega galti rokne ke liye
                        }
                    }
                }
            },
            flush(controller) {
                // Agar stream khatam hone par bhi kuch bacha ho
                if (leftover && leftover.startsWith('data: ')) {
                    try {
                        const trimmed = leftover.trim();
                        const jsonStr = trimmed.slice(6);
                        const parsed = JSON.parse(jsonStr);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            const geminiChunk = { candidates: [{ content: { parts: [{ text: content }] } }] };
                            controller.enqueue(encoder.encode(JSON.stringify(geminiChunk) + '\n'));
                        }
                    } catch (e) {}
                }
            }
        });

        return new Response(response.body.pipeThrough(transformStream), {
            headers: { 'Content-Type': 'text/event-stream' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
