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
                // Fetch user metrics securely using server admin key
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
                    
                    // Database PATCH executed behind server environment rules
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

        // 🛡️ SYSTEM INFERENCE & MULTIMODAL (VISION) DISPATCH
        const apiKey = process.env.GEMINI_API_KEY; 
        let incomingMessages = [];

        if (rawBody.contents) {
            // 👁️ GROQ VISION FORMATTER: Yahan images aur text dono process honge
            incomingMessages = rawBody.contents.map(c => {
                let contentArray = [];
                
                if (c.parts) {
                    c.parts.forEach(part => {
                        if (part.text) {
                            contentArray.push({ type: "text", text: part.text });
                        }
                        if (part.inlineData) {
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
                    content: contentArray
                };
            });
        } else {
            incomingMessages = rawBody.messages || [];
        }

        let fileContextChunk = "";
        if (rawBody.fileDataToken && rawBody.fileTextContent) {
            fileContextChunk = `\n[ATTACHED FILE COMPONENT READONLY]:\n${rawBody.fileTextContent}\n`;
        }

        const harvionMasterSystemPrompt = {
            role: 'system',
            content: `You are HARVION v6.0, an Apex Archon super-intelligence engineered natively by Harvion Labs. Master architect: Saurabh Kumar. Mirror prompt scripts smoothly.${fileContextChunk}`
        };

        let messages = [harvionMasterSystemPrompt, ...incomingMessages];

        // 🚀 GROQ VISION MODEL CALL
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.2-90b-vision-preview', // 🔥 Groq's Advanced Vision Model
                messages: messages,
                temperature: rawBody.temperature !== undefined ? parseFloat(rawBody.temperature) : 0.2,
                max_tokens: rawBody.max_tokens !== undefined ? parseInt(rawBody.max_tokens) : 1500,
                stream: false // 🛑 Taki tumhare Frontend ke JSON parser se match kare
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            console.error("Groq Engine Error:", errData);
            return new Response(JSON.stringify({ error: "Upstream API Error" }), { status: response.status });
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
