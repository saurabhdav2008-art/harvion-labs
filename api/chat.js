export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const rawBody = await req.json();
        const apiKey = process.env.GEMINI_API_KEY; // Groq key yahan use ho rahi hai

        // 1. Frontend ke Gemini format ko Groq format mein badlo
        const messages = rawBody.contents ? rawBody.contents.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: c.parts[0].text
        })) : (rawBody.messages || []);

        // 2. Groq API ko call karo
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

        // 3. 🔥 MAGIC: Groq ke stream ko wapas Gemini format mein convert karo live!
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        
        const transformStream = new TransformStream({
            transform(chunk, controller) {
                const text = decoder.decode(chunk);
                const lines = text.split('\n');
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const jsonStr = trimmed.slice(6);
                            const parsed = JSON.parse(jsonStr);
                            const content = parsed.choices?.[0]?.delta?.content;
                            
                            if (content) {
                                // Yeh frontend ko bilkul Gemini jaisa dikhega
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
                            // Malformed lines ko skip karo
                        }
                    }
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
