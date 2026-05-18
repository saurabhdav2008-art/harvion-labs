export const config = {
    runtime: 'edge',
};

// 🔥 SMART HELPER: Yeh frontend ke data ko Google ke format mein convert karega
function formatGeminiBody(incomingBody) {
    // Agar frontend pehle se hi Google format {"contents": ...} bhej raha hai
    if (incomingBody.contents) {
        return incomingBody;
    }

    // Agar frontend OpenAI ya Vercel AI SDK format {"messages": [...]} bhej raha hai
    if (incomingBody.messages && Array.isArray(incomingBody.messages)) {
        const contents = incomingBody.messages.map(msg => {
            const role = msg.role === 'assistant' ? 'model' : 'user';
            return {
                role: role,
                parts: [{ text: msg.content || msg.text || "" }]
            };
        });
        return { contents };
    }

    // Fallback: Agar sirf ek normal string ya kuch aur aaya hai
    return {
        contents: [{ parts: [{ text: typeof incomingBody === 'string' ? incomingBody : JSON.stringify(incomingBody) }] }]
    };
}

export default async function handler(req) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const rawBody = await req.json();
        
        // 🔍 LOGS: Yeh Vercel mein print karega ki frontend ne kya bheja
        console.log("📥 FRONTEND DATA:", JSON.stringify(rawBody));

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("🚨 ALERT: Vercel mein GEMINI_API_KEY nahi mili!");
            return new Response(JSON.stringify({ error: "API Key missing" }), { status: 500 });
        }

        // Data ko Google ke mutabik dhaalenge
        const formattedBody = formatGeminiBody(rawBody);
        console.log("📤 GOOGLE FORMATTED DATA:", JSON.stringify(formattedBody));

        // Official Stable API Route
       const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formattedBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("🚨 Google API Error:", errorText);
            return new Response(errorText, { 
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(response.body, {
            headers: { 'Content-Type': 'text/event-stream' }
        });

    } catch (error) {
        console.error("🚨 Catch Error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
