/**
 * Friendly greeting detector and responder
 * Detects simple greetings and returns friendly responses instantly
 */

const GREETING_PATTERNS = {
  pt: [
    /^(oi|olá|opa|e\?|hey|eae|tudo bem|como vai|como você está|boa noite|boa tarde|bom dia|tá bom|ok)\b/i,
    /^(hiii|hiiii|ooii|oii|opa|tá|ok)\b/i,
  ],
  en: [
    /^(hi|hello|hey|sup|howdy|what'?s up|how are you|how you doing|good morning|good afternoon|good evening)\b/i,
  ],
};

const GREETING_RESPONSES = {
  pt: [
    "Oi! 👋 Tudo bem? Como posso ajudar você hoje?",
    "Olá! 😊 No que você precisa de ajuda?",
    "Opa! Tudo certo? O que você deseja fazer?",
    "Eae! 🚀 Bora conversar? O que você quer?",
    "Oi! Seja bem-vindo! 🎉 Como posso te ajudar?",
    "Olá! Estou por aqui. O que você gostaria de fazer?",
  ],
  en: [
    "Hi there! 👋 What can I help you with?",
    "Hello! 😊 What would you like to do?",
    "Hey! 🚀 What's on your mind?",
    "Hi! Welcome! 🎉 How can I assist you?",
    "Hello! I'm here to help. What do you need?",
  ],
};

export function isGreeting(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  
  // Check Portuguese patterns
  for (const pattern of GREETING_PATTERNS.pt) {
    if (pattern.test(normalized)) return true;
  }
  
  // Check English patterns
  for (const pattern of GREETING_PATTERNS.en) {
    if (pattern.test(normalized)) return true;
  }
  
  return false;
}

export function getGreetingResponse(text: string): string {
  const normalized = text.trim().toLowerCase();
  
  // Detect language
  const isPtGreeting = GREETING_PATTERNS.pt.some(p => p.test(normalized));
  const responses = isPtGreeting ? GREETING_RESPONSES.pt : GREETING_RESPONSES.en;
  
  // Return random greeting response
  return responses[Math.floor(Math.random() * responses.length)];
}
