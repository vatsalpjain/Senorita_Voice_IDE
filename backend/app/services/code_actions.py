import re
from app.models.command import CommandResult, ActionType

def handle_action(command: CommandResult) -> dict | None:
    """
    For IDE actions (non-LLM), returns a structured instruction dict.
    For LLM actions (GENERATE_CODE, DEBUG_MODE, etc.), returns None.
    """
    action = command.action
    param  = command.param

    if action == ActionType.CREATE_FILE:
        return {"type": "CREATE_FILE", "filename": param}
    elif action == ActionType.OPEN_FILE:
        return {"type": "OPEN_FILE", "filename": param}
    elif action == ActionType.SAVE_FILE:
        return {"type": "SAVE_FILE", "filename": param or "current"}
    elif action == ActionType.DELETE_FILE:
        return {"type": "DELETE_FILE", "filename": param}
    elif action == ActionType.GOTO_LINE:
        numbers = re.findall(r"\d+", param)
        line = int(numbers[0]) if numbers else 1
        return {"type": "GOTO_LINE", "line": line}
    elif action == ActionType.SCROLL_TO:
        return {"type": "SCROLL_TO", "target": param}
    elif action == ActionType.FIND_IN_FILE:
        return {"type": "FIND_IN_FILE", "query": param}
    elif action == ActionType.TERMINAL_CMD:
        return {"type": "TERMINAL_CMD", "command": param}

    return None   # LLM actions handled by caller
