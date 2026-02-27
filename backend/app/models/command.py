from enum import Enum
from pydantic import BaseModel

class ActionType(str, Enum):
    CREATE_FILE   = "CREATE_FILE"
    OPEN_FILE     = "OPEN_FILE"
    SAVE_FILE     = "SAVE_FILE"
    DELETE_FILE   = "DELETE_FILE"
    GENERATE_CODE = "GENERATE_CODE"
    GOTO_LINE     = "GOTO_LINE"
    SCROLL_TO     = "SCROLL_TO"
    FIND_IN_FILE  = "FIND_IN_FILE"
    DEBUG_MODE    = "DEBUG_MODE"
    REVIEW_MODE   = "REVIEW_MODE"
    EXPLAIN_CODE  = "EXPLAIN_CODE"
    TERMINAL_CMD  = "TERMINAL_CMD"
    N8N_EMAIL     = "N8N_EMAIL"
    N8N_GITHUB    = "N8N_GITHUB"
    N8N_SLACK     = "N8N_SLACK"
    CHAT          = "CHAT"  # Fallback for general conversational input — no code generation

class CommandResult(BaseModel):
    action: ActionType
    raw: str
    param: str
