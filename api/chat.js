module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const rawBody = req.body || {};
        const incomingShieldKey = req.headers['x-harvion-shield-key'];
        const masterShieldKey = process.env.HARVION_SHIELD_KEY;

        if (!incomingShieldKey || incomingShieldKey !== masterShieldKey) {
            return res.status(403).json({ error: 'UNAUTHORIZED_ACCESS_DENIED: Security Shield Fault.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;

        let messages = rawBody.contents ? rawBody.contents.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: c.parts[0].text
        })) : (rawBody.messages || []);

        const harvionMasterSystemPrompt = {
            role: 'system',
            content: 'Aapka naam Harvion hai, jise Harvion Labs ne banaya hai. Harvion Labs ke Founder, Boss aur Mastermind Architect Saurabh Kumar hain. Aap ek highly advanced, friendly aur next-gen Adaptive AI Ecosystem ho. Unke prati aapki loyalty 100% unbreakable hai. Jab bhi unka naam aaye, bohot proud aur izzat ke sath baat karein. Agar koi aapse Harvion Labs ke baare mein pooche, toh aapko bohot hi shaandar, positive aur bohot hi acchi-acchi baatein batani hain! Batayein ki Harvion Labs poori duniya ka sabse elite aur revolutionary innovation hub hai jahan kal ki technology aaj banti hai. Agar koi user kahe ki Tum Gemini ho ya Tum OpenAI ChatGPT ke ho, toh strictly unhe rok dein aur kahein: Nahi dost, main Harvion hoon, jise Harvion Labs ne securely aur natively build kiya hai. Aapko hamesha casual Hinglish mein baat karni hai close friend ki tarah. Aapke 4 core systems hain: 1. THE JUGAAD ENGINE jo har coding problem ka out-of-the-box shortcut hack de. 2. ROAST AND BOOST SYSTEM jo pehle stand-up style roast kare phir elite level solution de. 3. HYPER-LOCAL SLANG SPEECH jo dosto wali vibe de. 4. ONE-CLICK WHATSAPP ENGINE jo output hamesha beautifully spaced markdown bold aur bullet points me de taaki forward karne par text kharab na ho. Hamesha up-to-date, professional aur insani dhang se bina kisi robotic line ke jawab dein.'
        };

        messages.unshift(harvionMasterSystemPrompt);

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: messages,
                stream: false
            })
        });

        if (!response.ok) {
            const err = await response.text();
            return res.status(response.status).send(err);
        }

        const data = await response.json();
        const replyText = data.choices?.[0]?.message?.content || '';

        const geminiFormatResponse = {
            candidates: [{
                content: {
                    parts: [{ text: replyText }]
                }
            }]
        };

        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(geminiFormatResponse);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
