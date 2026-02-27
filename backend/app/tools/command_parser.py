COMMAND_MAP = {
    # File operations (multi-word first)
    "create file":   "CREATE_FILE",
    "open file":     "OPEN_FILE",
    "save file":     "SAVE_FILE",
    "delete file":   "DELETE_FILE",
    # Navigation (multi-word first)
    "go to line":    "GOTO_LINE",
    "scroll to":     "SCROLL_TO",
    "find":          "FIND_IN_FILE",
    # Modes
    "debug":         "DEBUG_MODE",
    "review":        "REVIEW_MODE",
    "explain":       "EXPLAIN_CODE",
    # Terminal (multi-word first)
    "start server":  "TERMINAL_CMD",
    "install":       "TERMINAL_CMD",
    "run":           "TERMINAL_CMD",
    "git":           "TERMINAL_CMD",
    # Code generation (broad — check last)
    "implement":     "GENERATE_CODE",
    "write":         "GENERATE_CODE",
    "create":        "GENERATE_CODE",
    "add":           "GENERATE_CODE",
    # n8n workflows
    "email summary": "N8N_EMAIL",
    "create issue":  "N8N_GITHUB",
    "notify team":   "N8N_SLACK",
}

def parse_command(transcript: str) -> dict:
    """Parses text commands to map them to valid IDE Actions"""
    transcript_lower = transcript.lower()
    for phrase, action in COMMAND_MAP.items():
        if phrase in transcript_lower:
            return {
                "action": action,
                "raw": transcript,
                "param": transcript_lower.replace(phrase, "").strip()
            }
    # Default: treat unrecognized input as a plain conversational message — no code generation
    return {"action": "CHAT", "raw": transcript, "param": transcript}
