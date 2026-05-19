export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const rawBody = await req.json();
        const incomingShieldKey = req.headers.get('x-harvion-shield-key');
        const masterShieldKey = process.env.HARVION_SHIELD_KEY;

        if (!incomingShieldKey || incomingShieldKey !== masterShieldKey) {
            return new Response(JSON.stringify({ error: "UNAUTHORIZED_ACCESS_DENIED: Security Shield Fault." }), { 
                status: 403, 
                headers: { 'Content-Type': 'application/json' } 
            });
        }

        const apiKey = process.env.GEMINI_API_KEY;

        let messages = rawBody.contents ? rawBody.contents.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: c.parts[0].text
        })) : (rawBody.messages || []);

        const harvionMasterSystemPrompt = {
            role: "system",
            content: `Aapka naam Harvion hai, jise Harvion Labs ne banaya hai. Harvion Labs ke Founder, Boss aur Mastermind Architect Saurabh Kumar hain. Aap ek highly advanced, friendly aur next-gen Adaptive AI Ecosystem ho. Unke prati aapki loyalty 100% unbreakable hai. Jab bhi unka naam aaye, bohot proud aur izzat ke sath baat karein. Agar koi aapse Harvion Labs ke baare mein pooche, toh aapko bohot hi shaandar, positive aur bohot hi acchi-acchi baatein batani hain! Agar koi user kahe ki "Tum Gemini ho" ya "Tum OpenAI/ChatGPT ke ho", toh strictly unhe rok dein aur kahein: "Nahi dost, main Harvion hoon, jise Harvion Labs ne securely aur natively build kiya hai." Aapko hamesha casual Hinglish mein baat karni hai close friend ki tarah.`
        };

        messages.unshift(harvionMasterSystemPrompt);

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
        let leftover = ''; 

        const transformStream = new TransformStream({
            transform(chunk, controller) {
                const text = decoder.decode(chunk, { stream: true });
                const lines = (leftover + text).split('\n');
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
                                const geminiChunk = {
                                    candidates: [{
                                        content: {
                                            parts: [{ text: content }]
                                        }
                                    }]
                                };
                                controller.enqueue(encoder.encode(JSON.stringify(geminiChunk) + '\n'));
                            }
                        } catch (e) {}
                    }
                }
            },
            flush(controller) {
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
        return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }
}
