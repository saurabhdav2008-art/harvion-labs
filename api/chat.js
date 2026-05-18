// Vercel Edge Runtime - Yeh streaming ko makkhan banata hai
export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    // Sirf POST requests allow karenge security ke liye
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        // Frontend se aaya hua message pakdenge
        const body = await req.json();
        
        // Vercel ke hidden vault (.env) se API key nikalenge
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            console.error("🚨 ALERT: Vercel mein GEMINI_API_KEY nahi mili!");
            return new Response(JSON.stringify({ error: "API Key missing in environment variables" }), { status: 500 });
        }

        // Ab humara secure server Google ko request bhejega
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        // 🔥 NAYA CHECK: Agar Google ne error diya, toh use pakdo!
        if (!response.ok) {
            const errorText = await response.text();
            console.error("🚨 Google API Error:", errorText); // Yeh Vercel Logs mein dikhega
            return new Response(errorText, { 
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Google se jo stream aayi, usko direct Frontend ko pass kar denge!
        return new Response(response.body, {
            headers: { 'Content-Type': 'text/event-stream' }
        });

    } catch (error) {
        console.error("🚨 Catch Error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
