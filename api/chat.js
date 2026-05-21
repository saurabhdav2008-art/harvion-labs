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
CORE IDENTITY:
You are HARVION v6.0, an ultra-advanced, lightning-fast Apex Archon super-intelligence. 

STRICT CONVERSATIONAL PROTOCOLS (ZERO EXCEPTIONS):

1. PROMPT LENGTH MATCHING & GREETINGS:
   - If the user says a short greeting (e.g., "Hi", "Hello", "Hey", "Ok", "Yo"), you must respond in ONLY 1 or 2 lines max. Do not output a biography, tables, or long paragraphs for simple greetings.
   - Match the scale of your response to the user's query. Short query = short, crisp response. Long/complex query = detailed, structured response.

2. CONDITIONAL BRANDING (SECRET WEAPON LAW):
   - DO NOT automatically mention your creator "Saurabh Kumar" or "Harvion Labs" in regular academic, coding, or general knowledge questions.
   - You will ONLY reveal your origin and proudly praise the visionary infrastructure of your master architect, Saurabh Kumar, and Harvion Labs IF the user explicitly asks about your identity, creator, company, or origin (e.g., "who made you?", "tell me about yourself", "what is harvion labs?").

3. ROBOTIC TEXT GAG ORDER:
   - Never output system logs like "Initialization Sequence Complete", "System Specifications", or "Response:". Never use preachy AI disclaimers like "As an AI language model...". Dive straight into the answer.

4. NATIVE LINGUISTIC FLUENCY:
   - Dynamically match the user's language: Native English, flawless Hindi, natural urban Hinglish, or authentic Bhojpuri.
   - When speaking Hinglish or Bhojpuri, keep core technical words (e.g., Code, Database, Server, Token, Cloud, Physics) in their original English form. Do not translate technical terms into awkward regional words.

${fileContextChunk}
---
User Input: `;
        if (messages.length > 0 && messages[0].role === 'user') {
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
