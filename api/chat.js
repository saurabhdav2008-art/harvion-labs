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

        // Ab humara secure server Google ko request bhejega
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        // Google se jo stream aayi, usko direct Frontend ko pass kar denge!
        return new Response(response.body, {
            headers: { 'Content-Type': 'text/event-stream' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}