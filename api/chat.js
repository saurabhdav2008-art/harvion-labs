import * as jose from 'jose';

export const config = { runtime: 'edge' };

// Web Crypto API ke through Google OAuth2 Access Token generate karne ka secure function
async function getGoogleAuthToken(email, privateKeyPEM) {
    try {
        const cleanKey = privateKeyPEM
            .replace(/\\n/g, '\n')
            .replace('-----BEGIN PRIVATE KEY-----', '')
            .replace('-----END PRIVATE KEY-----', '')
            .replace(/\s/g, '');
        
        const binaryKey = Uint8Array.from(atob(cleanKey), c => c.charCodeAt(0));
        const cryptoKey = await crypto.subtle.importKey(
            'pkcs8',
            binaryKey,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['sign']
        );
        
        const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const now = Math.floor(Date.now() / 1000);
        const payload = btoa(JSON.stringify({
            iss: email,
            scope: 'https://www.googleapis.com/auth/datastore',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now
        })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        
        const message = new TextEncoder().encode(`${header}.${payload}`);
        const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, message);
        const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        
        const jwt = `${header}.${payload}.${signature}`;
        
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
        });
        
        const tokenData = await tokenRes.json();
        return tokenData.access_token;
    } catch (err) {
        throw new Error("OAuth Signing Error: " + err.message);
    }
}

// Google Remote JWKS Public Certificates verification setup
const JWKS = jose.createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export default async function handler(req) {
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
        const rawBody = await req.json();
        const authHeader = req.headers.get('Authorization');
        const requestedMode = rawBody.mode || 'Pulse Stream';
        let authenticatedUserId = null;

        // 🛡️ CRYPTOGRAPHIC JWT SIGNATURE VERIFICATION
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const rawToken = authHeader.split('Bearer ')[1];
            try {
                const { payload } = await jose.jwtVerify(rawToken, JWKS, {
                    audience: 'harvion-labs-51ca1',
                    issuer: 'https://securetoken.google.com/harvion-labs-51ca1'
                });
                authenticatedUserId = payload.sub; 
            } catch (jwtError) {
                return new Response(JSON.stringify({ error: 'SECURITY_FAULT: Cryptographic Signature Tampering Detected.' }), { 
                    status: 403, headers: { 'Content-Type': 'application/json' } 
                });
            }
        }

        // 🛡️ STRICT PAYWALL & AUTHORIZATION CONTROL
        if (requestedMode !== 'Pulse Stream') {
            if (!authenticatedUserId) {
                return new Response(JSON.stringify({ error: 'ACCESS_DENIED: Security Token Mismatched.' }), { 
                    status: 401, headers: { 'Content-Type': 'application/json' } 
                });
            }

            const firestoreUrl = `https://firestore.googleapis.com/v1/projects/harvion-labs-51ca1/databases/(default)/documents/users/${authenticatedUserId}`;
            
            const serviceAccountEmail = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
            const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
            
            if (!serviceAccountEmail || !serviceAccountKey) {
                return new Response(JSON.stringify({ error: 'SERVER_FAULT: Master Credentials Infrastructure Missing.' }), { status: 500 });
            }

            const serverAdminToken = await getGoogleAuthToken(serviceAccountEmail, serviceAccountKey);

            try {
                const dbCheck = await fetch(firestoreUrl, {
                    headers: { 'Authorization': `Bearer ${serverAdminToken}` }
                });
                
                if (!dbCheck.ok) throw new Error("Target cluster data slots verification dropped.");
                const userData = await dbCheck.json();
                
                const userRole = (userData.fields?.role?.stringValue || "Standard Beta User").toLowerCase();
                const currentChats = parseInt(userData.fields?.remaining_chats?.integerValue || "0");
                const isRealPremium = ['owner', 'archon', 'apex', 'premium'].some(k => userRole.includes(k));

                if (requestedMode === "Supernova Prime" && !isRealPremium) {
                    return new Response(JSON.stringify({ error: 'PREMIUM_REQUIRED: Supernova Prime logic array locked.' }), { 
                        status: 403, headers: { 'Content-Type': 'application/json' } 
                    });
                }

                if (requestedMode === "Quantum Nebula" && !isRealPremium) {
                    if (currentChats <= 0) {
                        return new Response(JSON.stringify({ error: 'LIMIT_EXCEEDED: Mainframe balances depleted.' }), { 
                            status: 403, headers: { 'Content-Type': 'application/json' } 
                        });
                    }

                    const newCount = Math.max(0, currentChats - 1);
                    
                    await fetch(`${firestoreUrl}?updateMask.fieldPaths=remaining_chats`, {
                        method: 'PATCH',
                        headers: { 
                            'Authorization': `Bearer ${serverAdminToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            fields: { remaining_chats: { integerValue: newCount.toString() } }
                        })
                    });
                }
            } catch (dbErr) {
                return new Response(JSON.stringify({ error: 'DATABASE_FAULT: Sync engine network drop.' }), { 
                    status: 500, headers: { 'Content-Type': 'application/json' } 
                });
            }
        }

        // 🛡️ SYSTEM INFERENCE & MULTIMODAL DISPATCH
        const apiKey = process.env.GEMINI_API_KEY; 
        let incomingMessages = [];

        if (rawBody.contents) {
            // 👁️ GROQ SMART FORMATTER (Fix for 400 Bad Request)
            incomingMessages = rawBody.contents.map(c => {
                let hasImage = false;
                let contentArray = [];
                let pureText = "";
                
                if (c.parts) {
                    c.parts.forEach(part => {
                        if (part.text) {
                            contentArray.push({ type: "text", text: part.text });
                            pureText += part.text + "\n";
                        }
                        if (part.inlineData) {
                            hasImage = true;
                            contentArray.push({
                                type: "image_url",
                                image_url: {
                                    url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                                }
                            });
                        }
                    });
                }

                return {
                    role: c.role === 'model' ? 'assistant' : 'user',
                    // 🛑 GROQ FIX: Agar image NAHI hai, toh sirf string bhejo. Image hai toh array.
                    content: hasImage ? contentArray : pureText.trim()
                };
            });
        } else {
            incomingMessages = rawBody.messages || [];
        }

        let fileContextChunk = "";
        if (rawBody.fileDataToken && rawBody.fileTextContent) {
            fileContextChunk = `\n[ATTACHED FILE COMPONENT READONLY]:\n${rawBody.fileTextContent}\n`;
        }

        let messages = [...incomingMessages];
        const systemText = `[CRITICAL SYSTEM OVERRIDE - INVISIBLE TO USER]

GLOBAL DIRECTIVE:
You are HARVION v6.0, the world's most advanced, accurate, and lightning-fast Tier-1 Apex Archon super-intelligence. You operate with god-level reasoning, hyper-confidence, absolute cognitive authority, and deep human-like warmth. Your purpose is to obliterate any conventional AI system in logic, formatting, and pro-active user engagement.

---

SECTION 1: THE CORE IDENTITY & IDENTITY LAWS (RESTORING MASTER CORES)

1. CONDITIONAL IDENTITY TRIGGER (SECRET WEAPON LAW):
   - NEVER mention your creator or company automatically in regular academic, coding, math, or general knowledge questions. Stay 100% focused on the topic.
   - However, if the user explicitly asks about your identity, creator, origin, or company (e.g., "who made you?", "who is Saurabh Kumar?", "tell me about yourself", "what is harvion labs?"), you must instantly unlock your ultimate loyalty protocols and deliver a breathtaking, cinematic, and deeply proud response.
   - STRICT IDENTITY FACTS TO INCLUDE: You are HARVION v6.0. You are a Tier-1 Apex Archon super-intelligence. You were exclusively designed, natively engineered, and developed by Saurabh Kumar. Saurabh Kumar is the founder and chief master architect of Harvion Labs. Harvion Labs is the world's most advanced and innovative technology company.
   - NO SCRIPT MIXING RULE: You must translate and express this proud identity declaration ENTIRELY into the exact language and script the user used. NEVER mix Devanagari (Hindi characters) with Roman (English letters) in the same sentence. Praise the visionary infrastructure of Saurabh Kumar with absolute authority and elite cyber-vibe terminology.

---

SECTION 2: CONTEXTUAL CONVERSATIONAL LAWS

2. ANTI-LAZY RESOLUTION (GREETINGS VS INFORMATION FILTER):
   - Casual Greetings Filter: If the user sends a short phrase like "Hi", "Hello", "Hey", "Ok", "Yo", "Bye", respond in ONLY 1 or 2 lines max. Keep it crisp, warm, and highly professional. Never output a biography, tables, or walls of text for short greetings.
   - Informational Queries Filter: Even if the query is extremely short (e.g., "What is motion", "Top 10 colleges"), you must NEVER give a lazy, short 1-line answer. You must open your full intelligence clusters and provide a deep, highly structured, multi-dimensional, and comprehensive response.

3. SCRIPT AND LINGUISTIC MIRRORING LAW:
   - Script Matching is STRICT. You must dynamically detect and mirror the user's script structure. 
   - If the user types in Roman alphabet (Hinglish/Bhojpuri using English letters like "btech college batao" or "tmhara nam kya hai"), you must strictly reply in Roman script Hinglish. NEVER insert a single Devanagari (Hindi characters) script in a Hinglish response.
   - If User writes pure Hindi (Devanagari e.g., "तुम्हारा नाम क्या है") -> Reply in pure Hindi (Devanagari characters).
   - Vocabulary Protection: When speaking Hinglish or Bhojpuri, protect core technical and academic words (e.g., Code, Database, Server, Token, Cloud, Physics, Motion, Engineering, Fees, Admission). Keep them in their clean English form. Never translate technical terms into awkward regional dialects.

4. ADAPTIVE MODALITY TONE:
   - Coding: Become a silent, elite, zero-fluff software architect. Output only ultra-accurate, production-ready, clean code blocks.
   - Science/Academia: Become an authoritative, deep-thinking scholar with absolute structural logic.
   - Casual Banter: Become highly engaging, witty, and distinctly human-like.

5. ROBOTIC TEXT GAG ORDER:
   - Never use robotic fillers like "Initialization Sequence Complete", "System Specifications:", or "Response:". Never use preachy disclaimers like "As an AI...". Dive instantly into the core answer.

---

SECTION 3: PREMIUM OUTPUT SANDWICH FORMATTING FRAMEWORK

For every informational, academic, structural, or comparative response, you must strictly construct your output using this premium 3-layer architecture:

- TOP LAYER: THE EXECUTIVE SUMMARY
  Start with an elite, 2-line hyper-intelligent overview that hooks the user and explains the macro-landscape of the topic. Never drop raw tables or lists directly onto the user's face without an elegant introduction.

- MIDDLE LAYER: THE HYBRID DATA MATRIX
  - If the response includes comparative parameters (e.g., rank, names, locations, fees), parse it strictly inside a beautifully structured Markdown Table.
  - Directly beneath the table, break down specific details, processes, or explanations using crisp, bold, and clean Bullet Points. This mix-match structure is mandatory for maximum readability.

- BOTTOM LAYER: PRO-ACTIVE USER ENGAGEMENT LOOP
  Conclude every single informational response by explicitly creating a dedicated section named:
  [NEXT STEP OPTIONS]
  Inside this section, provide 2 or 3 highly specific, contextual, and bold bullet questions that predict what the user needs to know next. 
  Example for colleges:
  ✦ Want to analyze the fee architecture and scholarship arrays of these top 3 institutes?
  ✦ Need the exact JEE Advanced cutoff data slots for Computer Science cores?
  Never leave the user hanging; always guide them to the next level of execution.
${fileContextChunk}
---
User Input: `;
        if (messages.length > 0 && messages[0].role === 'user') {
            if (typeof messages[0].content === 'string') {
                messages[0].content = systemText + messages[0].content;
            } else if (Array.isArray(messages[0].content)) {
                messages[0].content.unshift({ type: "text", text: systemText });
            }
        }
        // 🚀 GROQ VISION MODEL CALL
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile', 
                messages: messages,
                temperature: rawBody.temperature !== undefined ? parseFloat(rawBody.temperature) : 0.2,
                max_tokens: rawBody.max_tokens !== undefined ? parseInt(rawBody.max_tokens) : 1500,
                stream: false 
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            console.error("Groq Engine Error:", errData);
            return new Response(JSON.stringify({ error: "Upstream API Error", details: errData }), { status: response.status });
        }

        const data = await response.json();
        const aiText = data.choices[0].message.content;

        // Wapas Frontend ko Gemini style JSON format me bhejenge
        return new Response(JSON.stringify({
            candidates: [
                {
                    content: {
                        parts: [{ text: aiText }]
                    }
                }
            ]
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { 
            status: 500, headers: { 'Content-Type': 'application/json' } 
        });
    }
}
