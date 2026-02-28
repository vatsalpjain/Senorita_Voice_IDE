"""
Prompt Optimizer Service — Converts natural language to systematic, structured prompts.

This service transforms confusing, ambiguous, or poorly-structured user inputs
into clear, actionable prompts that yield better AI responses.

Features:
- Intent extraction and clarification
- Ambiguity resolution
- Context injection
- Task decomposition hints
- Code-specific terminology normalization
- Query expansion for better retrieval
"""
import re
import logging
from typing import Optional, Literal
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Data Structures
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class OptimizedPrompt:
    """Result of prompt optimization"""
    original: str                    # Original user input
    optimized: str                   # Optimized prompt
    intent: str                      # Detected intent (coding, debug, explain, etc.)
    action_verb: str                 # Primary action verb
    target: str                      # What the action targets
    constraints: list[str]           # Extracted constraints/requirements
    clarifications: list[str]        # Added clarifications
    confidence: float                # Confidence in optimization (0-1)
    was_modified: bool               # Whether prompt was actually changed


@dataclass
class PromptTemplate:
    """Template for structured prompts"""
    pattern: str
    intent: str
    template: str


# ─────────────────────────────────────────────────────────────────────────────
# Prompt Patterns and Templates
# ─────────────────────────────────────────────────────────────────────────────

# Common vague phrases and their structured replacements
VAGUE_TO_SPECIFIC = {
    # Vague requests
    "make it better": "improve the code by optimizing performance and readability",
    "fix it": "identify and fix the bug in",
    "make it work": "debug and fix the errors in",
    "do something": "implement functionality for",
    "help me": "assist with",
    "i need": "implement",
    "can you": "",  # Remove filler
    "could you": "",
    "would you": "",
    "please": "",
    "just": "",
    "maybe": "",
    "i think": "",
    "i guess": "",
    "sort of": "",
    "kind of": "",
    "like": "",
    "you know": "",
    "basically": "",
    
    # Ambiguous coding terms
    "the thing": "the function",
    "that part": "the selected code",
    "this stuff": "this code block",
    "the code": "the following code",
    "it": "the code",
    
    # Informal to formal
    "gonna": "going to",
    "wanna": "want to",
    "gotta": "need to",
    "dunno": "don't know",
    "kinda": "somewhat",
    "sorta": "somewhat",
}

# Action verb normalization
ACTION_VERBS = {
    # Coding actions
    "make": "create",
    "do": "implement",
    "write": "implement",
    "code": "implement",
    "build": "implement",
    "put": "add",
    "stick": "add",
    "throw in": "add",
    "get rid of": "remove",
    "take out": "remove",
    "kill": "remove",
    "nuke": "delete",
    "zap": "remove",
    "tweak": "modify",
    "change": "modify",
    "update": "modify",
    "redo": "refactor",
    "rewrite": "refactor",
    "clean up": "refactor",
    "tidy": "refactor",
    "optimize": "optimize",
    "speed up": "optimize for performance",
    "make faster": "optimize for performance",
    
    # Debug actions
    "fix": "debug and fix",
    "debug": "debug",
    "find bug": "identify the bug in",
    "what's wrong": "analyze the error in",
    "broken": "fix the broken",
    "not working": "debug why it's not working",
    "crashes": "fix the crash in",
    "error": "fix the error in",
    
    # Explain actions
    "explain": "explain",
    "tell me": "explain",
    "what is": "explain what is",
    "what does": "explain what",
    "how does": "explain how",
    "why": "explain why",
    "show me": "demonstrate",
}

# Intent patterns with confidence scores
INTENT_PATTERNS = [
    # High confidence patterns
    (r"\b(create|implement|build|make|add|write)\b.*\b(function|class|method|component|api|endpoint|service)\b", "coding", 0.95),
    (r"\b(fix|debug|error|bug|crash|broken|not working|fails)\b", "debug", 0.9),
    (r"\b(explain|what is|what does|how does|why|tell me about|describe)\b", "explain", 0.9),
    (r"\b(refactor|clean|optimize|improve|restructure)\b", "coding", 0.85),
    (r"\b(test|unit test|integration test|spec)\b", "coding", 0.85),
    (r"\b(delete|remove|get rid of)\b", "coding", 0.8),
    
    # Medium confidence patterns
    (r"\b(add|insert|put)\b.*\b(to|in|into)\b", "coding", 0.75),
    (r"\b(change|modify|update|edit)\b", "coding", 0.7),
    (r"\b(help|assist|support)\b", "chat", 0.6),
    
    # Low confidence - default to chat
    (r".*", "chat", 0.3),
]

# Structured prompt templates by intent
PROMPT_TEMPLATES = {
    "coding": """**Task:** {action} {target}
**Requirements:**
{requirements}
**Context:** {context}
**Constraints:** {constraints}""",
    
    "debug": """**Issue:** {problem}
**Expected Behavior:** {expected}
**Actual Behavior:** {actual}
**Context:** {context}
**Error Message:** {error}""",
    
    "explain": """**Question:** {question}
**Scope:** {scope}
**Detail Level:** {detail_level}
**Context:** {context}""",
    
    "refactor": """**Task:** Refactor {target}
**Goals:**
{goals}
**Preserve:** {preserve}
**Context:** {context}""",
}


# ─────────────────────────────────────────────────────────────────────────────
# Prompt Optimizer
# ─────────────────────────────────────────────────────────────────────────────

class PromptOptimizer:
    """
    Optimizes natural language prompts into structured, clear instructions.
    
    Usage:
        optimizer = PromptOptimizer()
        result = optimizer.optimize("make it work please")
        print(result.optimized)  # "debug and fix the errors in the code"
    """
    
    def __init__(self, use_llm: bool = False):
        """
        Initialize the optimizer.
        
        Args:
            use_llm: If True, use LLM for complex optimizations (slower but better)
        """
        self.use_llm = use_llm
    
    def optimize(
        self,
        prompt: str,
        context: Optional[dict] = None,
        intent_hint: Optional[str] = None,
    ) -> OptimizedPrompt:
        """
        Optimize a natural language prompt.
        
        Args:
            prompt: The user's raw input
            context: Optional context (file_path, language, selection, etc.)
            intent_hint: Optional hint about the intended action
        
        Returns:
            OptimizedPrompt with the improved version
        """
        original = prompt.strip()
        
        if not original:
            return OptimizedPrompt(
                original=original,
                optimized=original,
                intent="chat",
                action_verb="",
                target="",
                constraints=[],
                clarifications=[],
                confidence=0.0,
                was_modified=False,
            )
        
        # Step 1: Clean and normalize
        cleaned = self._clean_prompt(original)
        
        # Step 2: Detect intent
        intent, confidence = self._detect_intent(cleaned, intent_hint)
        
        # Step 3: Extract components
        action_verb = self._extract_action_verb(cleaned)
        target = self._extract_target(cleaned, context)
        constraints = self._extract_constraints(cleaned)
        
        # Step 4: Apply transformations
        optimized = self._transform_prompt(cleaned, intent, action_verb, target, context)
        
        # Step 5: Add clarifications based on context
        clarifications = self._generate_clarifications(optimized, context, intent)
        
        # Step 6: Inject context if available
        if context:
            optimized = self._inject_context(optimized, context)
        
        was_modified = optimized.lower().strip() != original.lower().strip()
        
        return OptimizedPrompt(
            original=original,
            optimized=optimized,
            intent=intent,
            action_verb=action_verb,
            target=target,
            constraints=constraints,
            clarifications=clarifications,
            confidence=confidence,
            was_modified=was_modified,
        )
    
    def _clean_prompt(self, prompt: str) -> str:
        """Remove filler words and normalize text"""
        result = prompt.lower()
        
        # Remove filler phrases
        for vague, specific in VAGUE_TO_SPECIFIC.items():
            if vague in result:
                result = result.replace(vague, specific)
        
        # Clean up whitespace
        result = re.sub(r'\s+', ' ', result).strip()
        
        # Capitalize first letter
        if result:
            result = result[0].upper() + result[1:]
        
        return result
    
    def _detect_intent(self, prompt: str, hint: Optional[str] = None) -> tuple[str, float]:
        """Detect the user's intent from the prompt"""
        if hint and hint in ("coding", "debug", "explain", "chat", "plan"):
            return hint, 1.0
        
        prompt_lower = prompt.lower()
        
        for pattern, intent, confidence in INTENT_PATTERNS:
            if re.search(pattern, prompt_lower):
                return intent, confidence
        
        return "chat", 0.3
    
    def _extract_action_verb(self, prompt: str) -> str:
        """Extract and normalize the primary action verb"""
        prompt_lower = prompt.lower()
        
        # Check for action verbs
        for informal, formal in ACTION_VERBS.items():
            if informal in prompt_lower:
                return formal
        
        # Try to find first verb-like word
        words = prompt_lower.split()
        action_words = ["create", "implement", "add", "remove", "fix", "debug", "explain", "refactor", "modify", "delete"]
        
        for word in words:
            if word in action_words:
                return word
        
        return ""
    
    def _extract_target(self, prompt: str, context: Optional[dict] = None) -> str:
        """Extract what the action targets"""
        prompt_lower = prompt.lower()
        
        # Common code targets
        targets = [
            "function", "method", "class", "component", "module", "file",
            "api", "endpoint", "route", "service", "handler", "controller",
            "model", "schema", "interface", "type", "variable", "constant",
            "test", "spec", "hook", "middleware", "decorator", "wrapper",
        ]
        
        for target in targets:
            if target in prompt_lower:
                # Try to get the name after the target word
                match = re.search(rf'{target}\s+(\w+)', prompt_lower)
                if match:
                    return f"{target} {match.group(1)}"
                return target
        
        # Use context if available
        if context:
            if context.get("selection"):
                return "the selected code"
            if context.get("symbol_at_cursor"):
                sym = context["symbol_at_cursor"]
                return f"{sym.get('kind', 'symbol')} {sym.get('name', '')}"
            if context.get("file_path"):
                return f"code in {context['file_path'].split('/')[-1]}"
        
        return "the code"
    
    def _extract_constraints(self, prompt: str) -> list[str]:
        """Extract constraints and requirements from the prompt"""
        constraints = []
        prompt_lower = prompt.lower()
        
        # Performance constraints
        if any(word in prompt_lower for word in ["fast", "efficient", "performance", "optimize", "speed"]):
            constraints.append("Optimize for performance")
        
        # Safety constraints
        if any(word in prompt_lower for word in ["safe", "secure", "validate", "sanitize"]):
            constraints.append("Ensure security and input validation")
        
        # Style constraints
        if any(word in prompt_lower for word in ["clean", "readable", "maintainable"]):
            constraints.append("Maintain clean, readable code")
        
        # Testing constraints
        if any(word in prompt_lower for word in ["test", "testable", "unit test"]):
            constraints.append("Include unit tests")
        
        # Type constraints
        if any(word in prompt_lower for word in ["typed", "typescript", "type safe"]):
            constraints.append("Use proper type annotations")
        
        # Error handling
        if any(word in prompt_lower for word in ["error", "handle", "catch", "try"]):
            constraints.append("Include proper error handling")
        
        # Documentation
        if any(word in prompt_lower for word in ["document", "comment", "docstring"]):
            constraints.append("Add documentation/comments")
        
        return constraints
    
    def _transform_prompt(
        self,
        prompt: str,
        intent: str,
        action_verb: str,
        target: str,
        context: Optional[dict] = None,
    ) -> str:
        """Transform the prompt into a clearer version"""
        
        # If prompt is already clear and specific, don't over-transform
        if len(prompt.split()) > 10 and action_verb:
            return prompt
        
        # Build structured prompt based on intent
        if intent == "coding":
            if action_verb and target:
                return f"{action_verb.capitalize()} {target}"
            return prompt
        
        elif intent == "debug":
            if "error" in prompt.lower() or "bug" in prompt.lower():
                return f"Debug and fix: {prompt}"
            return f"Identify and fix the issue: {prompt}"
        
        elif intent == "explain":
            if not prompt.lower().startswith(("explain", "what", "how", "why")):
                return f"Explain: {prompt}"
            return prompt
        
        return prompt
    
    def _generate_clarifications(
        self,
        prompt: str,
        context: Optional[dict],
        intent: str,
    ) -> list[str]:
        """Generate helpful clarifications based on context"""
        clarifications = []
        
        if context:
            # Add language-specific clarifications
            language = context.get("language", "")
            if language:
                clarifications.append(f"Language: {language}")
            
            # Add file context
            file_path = context.get("file_path", "")
            if file_path:
                filename = file_path.split("/")[-1].split("\\")[-1]
                clarifications.append(f"File: {filename}")
            
            # Add cursor position context
            cursor_line = context.get("cursor_line")
            if cursor_line:
                clarifications.append(f"At line: {cursor_line}")
        
        return clarifications
    
    def _inject_context(self, prompt: str, context: dict) -> str:
        """Inject relevant context into the prompt"""
        additions = []
        
        # Add language hint
        language = context.get("language", "")
        if language and language.lower() not in prompt.lower():
            additions.append(f"in {language}")
        
        # Add file hint
        file_path = context.get("file_path", "")
        if file_path:
            filename = file_path.split("/")[-1].split("\\")[-1]
            if filename.lower() not in prompt.lower():
                additions.append(f"in {filename}")
        
        if additions:
            return f"{prompt} ({', '.join(additions)})"
        
        return prompt
    
    async def optimize_with_llm(
        self,
        prompt: str,
        context: Optional[dict] = None,
    ) -> OptimizedPrompt:
        """
        Use LLM to optimize complex or ambiguous prompts.
        Falls back to rule-based optimization if LLM fails.
        """
        from app.services.groq_service import ask_llm
        
        system_prompt = """You are a prompt optimizer. Convert the user's natural language request into a clear, structured prompt for a coding AI assistant.

Rules:
1. Preserve the user's intent exactly
2. Remove filler words and ambiguity
3. Add specificity where missing
4. Use action verbs (create, implement, fix, refactor, explain)
5. Keep it concise but complete
6. Output ONLY the optimized prompt, nothing else

Examples:
- "make it work" → "Debug and fix the errors in the code"
- "add a thing that does login" → "Implement a login authentication function"
- "why broken" → "Explain why this code is failing and identify the bug"
- "clean this up" → "Refactor this code for better readability and maintainability"
"""
        
        try:
            context_str = ""
            if context:
                if context.get("language"):
                    context_str += f"\nLanguage: {context['language']}"
                if context.get("file_path"):
                    context_str += f"\nFile: {context['file_path']}"
                if context.get("selection"):
                    context_str += f"\nSelected code: {context['selection'][:200]}"
            
            user_prompt = f"Optimize this prompt:{context_str}\n\nUser said: \"{prompt}\""
            
            optimized = await ask_llm(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=0.3,
                max_tokens=200,
            )
            
            optimized = optimized.strip().strip('"').strip("'")
            
            # Detect intent from optimized prompt
            intent, confidence = self._detect_intent(optimized)
            action_verb = self._extract_action_verb(optimized)
            target = self._extract_target(optimized, context)
            constraints = self._extract_constraints(optimized)
            clarifications = self._generate_clarifications(optimized, context, intent)
            
            return OptimizedPrompt(
                original=prompt,
                optimized=optimized,
                intent=intent,
                action_verb=action_verb,
                target=target,
                constraints=constraints,
                clarifications=clarifications,
                confidence=0.9,
                was_modified=optimized.lower() != prompt.lower(),
            )
            
        except Exception as e:
            logger.warning(f"LLM optimization failed, falling back to rules: {e}")
            return self.optimize(prompt, context)


# ─────────────────────────────────────────────────────────────────────────────
# Quick Optimization Functions
# ─────────────────────────────────────────────────────────────────────────────

def expand_query(query: str) -> list[str]:
    """
    Expand a search query into multiple related queries for better retrieval.
    
    Args:
        query: Original search query
    
    Returns:
        List of expanded queries including the original
    """
    queries = [query]
    query_lower = query.lower()
    
    # Add synonyms
    synonyms = {
        "auth": ["authentication", "login", "signin", "authorize"],
        "user": ["account", "profile", "member"],
        "api": ["endpoint", "route", "handler"],
        "db": ["database", "storage", "repository"],
        "ui": ["interface", "component", "view"],
        "error": ["exception", "bug", "issue", "failure"],
        "config": ["configuration", "settings", "options"],
        "test": ["spec", "unit test", "integration test"],
    }
    
    for key, syns in synonyms.items():
        if key in query_lower:
            for syn in syns[:2]:  # Limit expansions
                queries.append(query_lower.replace(key, syn))
    
    return list(set(queries))[:5]  # Dedupe and limit


def normalize_code_terms(text: str) -> str:
    """
    Normalize informal code terminology to standard terms.
    
    Args:
        text: Text with potentially informal terms
    
    Returns:
        Text with normalized terminology
    """
    normalizations = {
        "func": "function",
        "fn": "function",
        "var": "variable",
        "const": "constant",
        "param": "parameter",
        "arg": "argument",
        "obj": "object",
        "arr": "array",
        "str": "string",
        "int": "integer",
        "bool": "boolean",
        "dict": "dictionary",
        "async": "asynchronous",
        "sync": "synchronous",
        "req": "request",
        "res": "response",
        "err": "error",
        "msg": "message",
        "btn": "button",
        "nav": "navigation",
        "auth": "authentication",
        "db": "database",
        "api": "API",
        "ui": "UI",
        "ux": "UX",
    }
    
    result = text
    for abbrev, full in normalizations.items():
        # Only replace if it's a whole word
        result = re.sub(rf'\b{abbrev}\b', full, result, flags=re.IGNORECASE)
    
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Global Instance
# ─────────────────────────────────────────────────────────────────────────────

_optimizer: Optional[PromptOptimizer] = None


def get_prompt_optimizer(use_llm: bool = False) -> PromptOptimizer:
    """Get or create the global prompt optimizer"""
    global _optimizer
    if _optimizer is None:
        _optimizer = PromptOptimizer(use_llm=use_llm)
    return _optimizer


def optimize_prompt(
    prompt: str,
    context: Optional[dict] = None,
    intent_hint: Optional[str] = None,
) -> OptimizedPrompt:
    """
    Convenience function to optimize a prompt.
    
    Args:
        prompt: User's raw input
        context: Optional context dict
        intent_hint: Optional intent hint
    
    Returns:
        OptimizedPrompt with improved version
    """
    return get_prompt_optimizer().optimize(prompt, context, intent_hint)


async def optimize_prompt_with_llm(
    prompt: str,
    context: Optional[dict] = None,
) -> OptimizedPrompt:
    """
    Optimize a prompt using LLM for complex cases.
    
    Args:
        prompt: User's raw input
        context: Optional context dict
    
    Returns:
        OptimizedPrompt with LLM-improved version
    """
    optimizer = PromptOptimizer(use_llm=True)
    return await optimizer.optimize_with_llm(prompt, context)
