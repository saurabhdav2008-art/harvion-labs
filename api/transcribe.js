import { Groq } from 'groq-sdk';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
    api: { bodyParser: false }, // Multipart audio data stream ke liye default parser off
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method drop.' });

    // 🔥 Vercel serverless link ko force-wait karwane ke liye Promise
    return new Promise((resolve) => {
        const form = formidable({});
        
        form.parse(req, async (err, fields, files) => {
            if (err) {
                res.status(500).json({ error: 'Buffer allocation failure.' });
                return resolve();
            }

            let filePath = null;

            try {
                // COMPATIBILITY CHECK: Formidable ke versions ke hisab se
                const audioFile = Array.isArray(files.file) ? files.file[0] : files.file;
                
                if (!audioFile) {
                    res.status(400).json({ error: 'No audio payload found.' });
                    return resolve();
                }

                filePath = audioFile.filepath || audioFile.path;

                // 🎙️ GROQ WHISPER ENGINE INTERFACE CALL
                const transcription = await groq.audio.transcriptions.create({
                    file: fs.createReadStream(filePath),
                    model: 'whisper-large-v3',
                    response_format: 'json',
                    
                    // 🔥 HALLUCINATION & SPELLING FIXES:
                    temperature: 0.0, // AI ko strict banata hai taaki faltu spelling na padhe
                    prompt: "This is a normal conversation. Transcribe the audio naturally without spelling out words letter by letter. Keep the original language intact, whether it is Hindi, English, Hinglish, or Bhojpuri.",
                    // Note: 'language' parameter nahi diya, taaki AI khud detect kare.
                });

                res.status(200).json({ text: transcription.text });
            } catch (error) {
                console.error("Transcription error:", error);
                res.status(500).json({ error: error.message });
            } finally {
                // 🔥 CLEANUP LOOPHOLE FIXED: Memory leak aur 500 Server Error se bachane ke liye
                if (filePath && fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (cleanupError) {
                        console.error("Failed to delete temp file:", cleanupError);
                    }
                }
                // Promise resolve hona zaroori hai taaki serverless chain safe tarike se end ho
                resolve(); 
            }
        });
    });
}
