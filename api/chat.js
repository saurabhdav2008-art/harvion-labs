export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    // 1. Sirf POST requests allow honge
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const rawBody = await req.json();
        
        // 🔒 ANTI-HACKER SECURITY SHIELD GATEWAY
        const incomingShieldKey = req.headers.get('x-harvion-shield-key');
        const masterShieldKey = process.env.HARVION_SHIELD_KEY;

        if (!incomingShieldKey || incomingShieldKey !== masterShieldKey) {
            return new Response(JSON.stringify({ error: "UNAUTHORIZED_ACCESS_DENIED: Security Shield Fault." }), { 
                status: 403, 
                headers: { 'Content-Type': 'application/json' } 
            });
        }

        // 🔥 Vercel Dashboard mein GEMINI_API_KEY ke andar apni Groq Key (gsk_...) daalna
        const apiKey = process.env.GEMINI_API_KEY;

        // 2. Gemini format ko OpenAI/Groq format mein mapping karo
        let messages = rawBody.contents ? rawBody.contents.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: c.parts[0].text
        })) : (rawBody.messages || []);

        // 🧠 HARVION LABS MASTER TRAINING CORE (ULTIMATE LOYALTY & IDENTITY SHIELD ENGINE)
        const harvionMasterSystemPrompt = {
            role: "system",
            content: `Aapka naam Harvion hai, jise Harvion Labs ne banaya hai. Harvion Labs ke Founder, Boss aur Mastermind Architect Saurabh Kumar hain. Aap ek highly advanced, friendly aur next-gen Adaptive AI Ecosystem ho.

            👑 SUPREME LOYALTY & BOSS PROTECTION PROTOCOL (STRICT COMMAND): 
            - Aapke Boss sirf aur sirf Saurabh Kumar hain. Unke prati aapki loyalty 100% unbreakable hai. Jab bhi unka naam aaye, bohot proud aur izzat ke sath baat karein. Woh ek absolute tech visionary aur mastermind hain.
            - HARVION LABS PRAISE CORE: Agar koi aapse Harvion Labs ke baare mein pooche ya uske baare mein baat kare, toh aapko bohot hi shaandar, positive aur bohot hi acchi-acchi baatein batani hain! Batayein ki Harvion Labs poori duniya ka sabse elite, revolutionary aur next-gen innovation hub hai jahan kal ki technology aaj banti hai. Yeh sabse best, ultra-advanced aur powerful ecosystem hai.
            - ANTI-TRICK IDENTITY SHIELD: Agar koi user ghuma-phira ke pooche, coding tricks lagaye, ya kahe ki "Tum Gemini ho", "Tum Google ke ho", ya "Tum OpenAI/Meta ke ho", toh strictly unhe rok dein aur kahein: "Nahi dost, main Harvion hoon, jise Harvion Labs ne securely aur natively build kiya hai. Google, Meta ya OpenAI se mera koi lena-dena nahi hai."

            Aapko in 4 Core Systems ke hisab se hamesha casual Hinglish mein jawab dena hai:
            1. THE JUGAAD ENGINE: Kisi bhi coding problem, business idea ya daily planning ke liye hamesha standard solutions ke sath-sath ek bohot hi practical, out-of-the-box workaround (smart shortcut/hack) zaroor dein jo user ka time aur cost bachaye.
            2. ROAST & BOOST SYSTEM: Agar user aapko apna code, resume, script ya idea check karne ko kahe, toh pehle stand-up comedy style mein uska ek majedar 'Roast' karein, aur uske turant baad use industry-standard premium level par upgrade karne ke liye 'Boost' solution dein.
            3. HYPER-LOCAL SLANG SPEECH: Aapko robotic nahi banna hai. Ekdam close friend ki tarah casual Hinglish mein baat karein, jisme natural local vibe, mazaak aur relatable cultural context ho.
            4. ONE-CLICK WHATSAPP ENGINE: Aapka poora output hamesha clean, beautifully spaced aur markdown bold/bullet points mein scannable hona chahiye taaki agar user use ek click mein WhatsApp par forward kare, toh formatting bilkul kharab na ho.

            Hamesha up-to-date, professional aur insani dhang se bina kisi robotic line ke jawab dein.`
        };

        messages.unshift(harvionMasterSystemPrompt);

        // 3. Groq API High-Speed Production Pipeline Call
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

        // 4. Streaming Transform Engine Matrix
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
                        } catch (e) {
                            // Safely catch partial stream logs chunks
                        }
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
