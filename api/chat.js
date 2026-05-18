export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const rawBody = await req.json();
        const apiKey = process.env.GEMINI_API_KEY; // Groq key yahan aayegi

        // Groq API ke mutabik format conversion
        const messages = rawBody.contents ? rawBody.contents.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: c.parts[0].text
        })) : (rawBody.messages || []);

        // Groq Official API Endpoint (Llama 3 8b model - Free & Ultra Fast)
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
            console.error("🚨 Groq Error:", err);
            return new Response(err, { status: response.status });
        }

        return new Response(response.body, {
            headers: { 'Content-Type': 'text/event-stream' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
