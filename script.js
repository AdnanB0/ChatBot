import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Use a self-executing function to keep variables local
(() => {   
    
    // Set log level for debugging Firestore issues
    setLogLevel('Debug');

    // Global references
    let app, db, auth, userId, appId;
    let isSending = false; // Prevents multiple messages while AI is loading
    let isFirebaseReady = false; // State to track if Firebase is fully set up
    
    // --- NEW: Typing State Management for Interruption ---
    let typingState = {
        timeoutId: null,
        targetElement: null,
        fullText: null,
        isRunning: false
    };

    // DOM Elements
    const startScreen = document.getElementById('start-screen');
    const startButton = document.getElementById('start-button');
    const buAiDisplay = document.getElementById('bu-ai-display');
    const chatContainer = document.getElementById('chat-container');
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-button');
    const chatWindow = document.getElementById('chat-window');
    const aiLoadingIndicator = document.getElementById('ai-loading');
    const userInfo = document.getElementById('user-info');

    // --- TONE.JS SOUND EFFECT SETUP ---
    function createWhooshSynth() {
        // Tone.js must be globally available from the <script> tag in index.html
        const noise = new Tone.NoiseSynth({
            noise: { type: "pink" },
            envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.05 }
        });
        const filter = new Tone.Filter(20000, "lowpass").toDestination();
        noise.connect(filter);
        return { noise, filter };
    }

    function playWhoosh(synth) {
        const now = Tone.now();
        const timeConstant = 0.1; 
        
        synth.filter.frequency.setValueAtTime(15000, now);
        synth.filter.frequency.setTargetAtTime(500, now, timeConstant);
        synth.noise.triggerAttackRelease(0.4, now);
    }
    
    const whooshSynth = createWhooshSynth();


    // --- UTILITY: TYPEWRITER EFFECT & INTERRUPTION (Simplified for brevity) ---
    function stopTyping(isInstantComplete = false) {
        if (typingState.timeoutId !== null) {
            clearTimeout(typingState.timeoutId);
            typingState.timeoutId = null;
            typingState.isRunning = false;

            if (isInstantComplete && typingState.targetElement && typingState.fullText) {
                const paragraphs = typingState.fullText.split('\n\n');
                const completedHtml = paragraphs.map(p => `<p class="mb-3">${p.replace(/\n/g, '<br>')}</p>`).join('');
                typingState.targetElement.innerHTML = completedHtml;
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }
        }
        typingState = { timeoutId: null, targetElement: null, fullText: null, isRunning: false };
    }

    function typeWriter(element, fullText) {
        stopTyping(true);
        aiLoadingIndicator.classList.add('hidden');

        let processedText = fullText;
        processedText = processedText.replace(/\n\s*([*-]|\d+\.)/g, '\n\n$1');
        processedText = processedText.replace(/([.?!])\s*\n\s*([A-Z*])/g, '$1\n\n$2');
        const paragraphs = processedText.split('\n\n'); 
        
        typingState = {
            timeoutId: null,
            targetElement: element,
            fullText: processedText, 
            paragraphs: paragraphs.map(p => p.replace(/\n/g, '<br>')), 
            paragraphIndex: 0,
            charIndex: 0,
            isRunning: true
        };

        element.innerHTML = '';
        typeStep();
    }

    function typeStep() {
        if (!typingState.isRunning) return; 

        const { paragraphs, paragraphIndex, charIndex, targetElement } = typingState;

        if (paragraphIndex >= paragraphs.length) {
            typingState.isRunning = false;
            return;
        }

        const currentParagraphText = paragraphs[paragraphIndex].replace(/<br>/g, '\n');
        
        if (charIndex < currentParagraphText.length) {
            let nextChar = currentParagraphText.charAt(charIndex);
            
            let currentParagraphElement = targetElement.lastElementChild;
            if (!currentParagraphElement || currentParagraphElement.tagName !== 'P' || currentParagraphElement.dataset.paragraphIndex !== String(paragraphIndex)) {
                currentParagraphElement = document.createElement('p');
                currentParagraphElement.className = "mb-3 text-white"; 
                currentParagraphElement.dataset.paragraphIndex = String(paragraphIndex);
                targetElement.appendChild(currentParagraphElement);
            }
            
            currentParagraphElement.textContent += nextChar;

            typingState.charIndex++;
            typingState.timeoutId = setTimeout(typeStep, 10);
        } else {
            typingState.paragraphIndex++;
            typingState.charIndex = 0;
            typingState.timeoutId = setTimeout(typeStep, 300);
        }
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }


    // --- FIREBASE INITIALIZATION & CHAT LOGIC ---

    function getChatCollectionRef() {
        if (!db) {
            console.error("Firestore not initialized.");
            return null;
        }
        // Collection path is /artifacts/{appId}/public/data/messages
        const collectionPath = `/artifacts/${appId}/public/data/messages`;
        return collection(db, collectionPath);
    }

    /**
     * @description Initializes Firebase. Uses placeholder credentials if environment variables are missing.
     */
    async function initializeFirebase() {
        let authReady = false;
        let firebaseConfig = null;
        appId = 'local-dev-app-id'; // Default local ID

        try {
            // 1. Check for Canvas environment variables
            if (typeof __firebase_config !== 'undefined' && typeof __initial_auth_token !== 'undefined') {
                // Use Canvas provided configurations
                firebaseConfig = JSON.parse(__firebase_config);
                appId = __app_id;
                
                app = initializeApp(firebaseConfig);
                db = getFirestore(app);
                auth = getAuth(app);

                // Authenticate with custom token
                await signInWithCustomToken(auth, __initial_auth_token);
                authReady = true;

            } else {
                // 2. Running locally or environment variables are missing - Use Placeholder Config
                const localConfig = {
                    apiKey: "AIzaSy-Local-Placeholder",
                    authDomain: "local-dev-app.firebaseapp.com",
                    projectId: "local-dev-chat",
                    storageBucket: "local-dev-chat.appspot.com",
                    messagingSenderId: "1234567890",
                    appId: "1:1234567890:web:local-dev-id"
                };

                app = initializeApp(localConfig);
                db = getFirestore(app);
                auth = getAuth(app);
                
                // Sign in anonymously for local testing
                await signInAnonymously(auth);
                authReady = true;

                renderSystemMessage("Running in Local Dev Mode. Data will not be persisted.");
            }
        
            if (authReady) {
                userId = auth.currentUser?.uid || crypto.randomUUID();
                userInfo.textContent = `User ID: ${userId.substring(0, 10)}... (Public Chat)`;
                isFirebaseReady = true; // Set flag to true on successful setup
            }

        } catch (error) {
            // This is the block that executes when the dummy config still throws an error locally.
            console.error("Firebase Initialization Failed:", error);
            userInfo.textContent = "Error: Authentication or configuration failed."; // The message you saw
            // IMPORTANT: We do NOT set isFirebaseReady = false here. We assume the UI should still open.
            // isFirebaseReady remains false from its initial definition.
        }
    }
    
    /**
     * Renders a standard text message bubble (either user or AI). (Simplified for brevity)
     */
    function renderMessage(message, isNew = false) {
        const isUser = message.senderId === userId;
        const isAI = message.senderId === 'Bu.ai';
        const messageDiv = document.createElement('div');
        messageDiv.className = `flex ${isUser ? 'justify-end' : 'justify-start'}`;

        const bubbleClass = isUser 
            ? 'bg-bing-green-dark text-white rounded-tl-xl rounded-bl-xl rounded-br-xl shadow-lg'
            : (isAI ? 'bg-gray-700 text-white rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-md' : 'bg-gray-500 text-white rounded-xl shadow-sm');
        
        const senderName = isUser ? 'You' : (isAI ? 'Bu.ai' : message.senderId.substring(0, 4) + '...');

        const bubbleContent = document.createElement('div');
        bubbleContent.className = `${bubbleClass} p-3 max-w-[80%] min-w-[100px] break-words`;
        bubbleContent.innerHTML = `<p class="text-xs font-medium mb-1 ${isUser ? 'text-bing-green-light' : 'text-gray-300'}">${senderName}</p>`;
        
        const textContainer = document.createElement('div');
        bubbleContent.appendChild(textContainer);
        messageDiv.appendChild(bubbleContent);
        chatWindow.appendChild(messageDiv);
        
        if (isNew && isAI && !message.structuredData) {
            typeWriter(textContainer, message.text);
        } else if (!isAI) {
            textContainer.innerHTML = `<p class="mb-3">${message.text}</p>`;
            chatWindow.scrollTop = chatWindow.scrollHeight;
        } else {
            let processedText = message.text;
            processedText = processedText.replace(/\n\s*([*-]|\d+\.)/g, '\n\n$1');
            processedText = processedText.replace(/([.?!])\s*\n\s*([A-Z*])/g, '$1\n\n$2');
            const paragraphs = processedText.split('\n\n');
            textContainer.innerHTML = paragraphs.map(p => `<p class="mb-3">${p.replace(/\n/g, '<br>')}</p>`).join('');
        }
    }
    
    // Existing renderStructuredMessage (kept for consistency)
    function renderStructuredMessage(message, isNew = false) {
        // ... (structured message rendering logic remains unchanged) ...
        stopTyping(true);

        let courses;
        try {
            courses = JSON.parse(message.structuredData);
            if (!Array.isArray(courses)) throw new Error("Structured data is not an array.");
        } catch (e) {
            console.error("Failed to parse structured data:", e);
            message.text = "I tried to generate a structured list, but encountered an error. Here is the raw response: " + message.structuredData;
            renderMessage(message, isNew);
            return;
        }

        if (isNew) {
            aiLoadingIndicator.classList.add('hidden');
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `flex justify-start`;

        const bubbleContent = document.createElement('div');
        bubbleContent.className = `p-4 max-w-[90%] break-words bg-gray-700 rounded-tr-xl rounded-br-xl rounded-bl-xl shadow-lg`;

        const header = `<p class="text-xs font-medium mb-1 text-gray-300">Bu.ai</p>`;
        
        let courseCardsHtml = courses.map(course => `
            <div class="p-4 bg-gray-800 rounded-lg border-l-4 border-bing-green-dark shadow-xl mb-3 transition duration-300 hover:bg-gray-700/50 cursor-pointer">
                <h4 class="text-white text-md font-bold">${course.courseID} - ${course.name}</h4>
                <p class="text-xs text-gray-400 mt-1">${course.description}</p>
            </div>
        `).join('');

        bubbleContent.innerHTML = `
            ${header}
            <div class="space-y-2 pt-3 border-t border-gray-700/50 mt-1">
                ${courseCardsHtml}
            </div>
        `;

        messageDiv.appendChild(bubbleContent);
        chatWindow.appendChild(messageDiv);
        
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }


    function subscribeToChat() {
        if (!isFirebaseReady || !db) return; // Guard against uninitialized state

        const collectionRef = getChatCollectionRef();
        if (!collectionRef) return;
        
        // IMPORTANT: Avoid using orderBy for local development without proper indexes.
        const q = query(collectionRef, orderBy("timestamp", "asc"));

        chatWindow.innerHTML = '';
        
        onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const message = { id: change.doc.id, ...change.doc.data() }; 
                    
                    if (message.senderId === userId || message.senderId === 'Bu.ai') {
                        if (message.structuredData) {
                            renderStructuredMessage(message, true); 
                        } else {
                            renderMessage(message, true);
                        }
                    }
                }
            });
        });
    }

    async function handleSendMessage() {
        const text = chatInput.value.trim();

        if (text === "" || isSending) {
            return;
        }
        
        stopTyping(true);

        isSending = true;
        chatInput.setAttribute('disabled', 'true');
        sendButton.setAttribute('disabled', 'true');
        aiLoadingIndicator.classList.remove('hidden');

        try {
            // 1. Send User Message
            const chatRef = getChatCollectionRef();
            // Only attempt to write if Firebase is actually ready
            if (isFirebaseReady && chatRef) {
                await addDoc(chatRef, {
                    senderId: userId,
                    text: text,
                    timestamp: serverTimestamp(),
                });
            } else {
                renderSystemMessage("Warning: Database connection failed. Showing AI response locally only.");
            }
            
            chatInput.value = '';

            // 2. Call the LLM (This must succeed for the app to work locally)
            await callLLMEndpoint(text);

        } catch (e) {
            console.error("Error sending message or calling LLM:", e);
            renderSystemMessage('System Error: Sorry, the API call or external service failed.');
        } finally {
            isSending = false;
            chatInput.removeAttribute('disabled');
            sendButton.removeAttribute('disabled');
            chatInput.focus();
        }
    }

    async function callLLMEndpoint(userMessage) {
        // We rely 100% on the hosting environment to inject the API key via headers.
        // We do not define an API key variable or append the ?key= query parameter.
        const model = "gemini-2.5-flash-preview-05-20";
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        
        const systemPrompt = `You are Bu.ai, a friendly and professional academic advisor bot for Binghamton University students. Your primary role is to answer questions about courses, graduation requirements, majors, and academic policies at Binghamton.
        Keep your responses concise, helpful, and encouraging. **Ensure that bulleted lists and distinct paragraphs are separated by a double newline (\\n\\n) for best readability.**`;
        
        const payload = {
            contents: [{ parts: [{ text: userMessage }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        let responseText = "Sorry, I encountered an issue connecting to the core advisory model. Please try again in a moment.";
        let maxRetries = 3;
        let delay = 1000;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`API returned status ${response.status}`);
                }

                const result = await response.json();
                const candidate = result.candidates?.[0];

                if (candidate && candidate.content?.parts?.[0]?.text) {
                    responseText = candidate.content.parts[0].text;
                    break; 
                } else {
                        responseText = "The model did not return a valid text response.";
                        break;
                }

            } catch (error) {
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; 
                } else {
                    console.error("Final API attempt failed:", error);
                }
            }
        }

        // 3. Add the AI response to Firestore or use fallback
        const chatRef = getChatCollectionRef();
        if (isFirebaseReady && chatRef) {
            await addDoc(chatRef, {
                senderId: 'Bu.ai',
                text: responseText,
                timestamp: serverTimestamp(),
            });
        } else {
            // Fallback render if Firestore is not initialized (e.g., in local mode)
            const fallbackMessage = {
                senderId: 'Bu.ai',
                text: responseText,
                timestamp: new Date()
            };
            renderMessage(fallbackMessage, true);
        }
    }

    function renderSystemMessage(text) {
        const systemDiv = document.createElement('div');
        systemDiv.className = 'text-center text-xs text-gray-500 italic py-2';
        systemDiv.textContent = `[System] ${text}`;
        chatWindow.appendChild(systemDiv);
        setTimeout(() => chatWindow.scrollTop = chatWindow.scrollHeight, 50);
    }

    // --- ANIMATION SEQUENCE & MAIN START ---
    
    function startSequence() {
        Tone.start().then(() => {
            playWhoosh(whooshSynth);
        });
        
        startScreen.classList.add('start-screen-exit');
        
        setTimeout(() => {
            startScreen.classList.add('hidden');
            
            buAiDisplay.classList.remove('opacity-0');
            
            setTimeout(() => {
                chatContainer.classList.remove('initial-state');
                chatContainer.classList.add('active-state');

                buAiDisplay.style.transition = 'opacity 0.3s ease-out 0.2s';
                buAiDisplay.classList.add('opacity-0');
                
                // 7. Initialize Firebase and start listening for messages
                initializeFirebase().then(() => {
                    subscribeToChat();

                    // 8. ENABLE INPUT UNCONDITIONALLY (THIS IS THE FIX)
                    setTimeout(() => {
                        if (chatInput && sendButton) {
                            chatInput.removeAttribute('disabled');
                            sendButton.removeAttribute('disabled');
                            chatInput.focus(); 
                        }
                        // The error message is already shown if Firebase failed.
                        if (!isFirebaseReady) {
                             renderSystemMessage("Local Mode enabled. Chat history will NOT be saved, but the AI advisor is functional.");
                        }
                    }, 800); 
                });
                
            }, 400); 
            
        }, 400); 
    }

    // --- EVENT LISTENERS ---

    startButton.addEventListener('click', startSequence);
    sendButton.addEventListener('click', handleSendMessage);
    
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !chatInput.disabled) {
            handleSendMessage();
        }
    });

})();
