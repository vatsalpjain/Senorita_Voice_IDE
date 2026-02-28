import logging
import json
from typing import List, Optional
from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import io

from app.models.request import TextCommandRequest, TTSRequest, SummarizeRequest
from app.models.response import SenoResponse
from app.tools.command_parser import parse_command
from app.services.groq_service import ask_llm
from app.services.deepgram_stt import transcribe_audio
from app.services.deepgram_tts import text_to_speech
from app.services.code_actions import handle_action
from app.services.n8n_service import trigger_n8n
from app.services.file_registry import get_file_registry
from app.services.smart_context import set_project_root, get_project_root
from app.services.memory_service import get_memory_service
from app.services.symbol_indexer import get_indexer
from app.services.embedding_service import get_embedding_service
from app.models.command import CommandResult, ActionType
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

LLM_ACTIONS = {"GENERATE_CODE", "DEBUG_MODE", "REVIEW_MODE", "EXPLAIN_CODE"}
N8N_ACTIONS = {"N8N_EMAIL", "N8N_GITHUB", "N8N_SLACK"}

@router.post("/command", response_model=SenoResponse)
async def process_command(request: TextCommandRequest):
    """Processes explicit text requests simulating the voice transcript action process"""
    parsed = parse_command(request.transcript)
    action = parsed["action"]
    param  = parsed["param"]
    
    response_data = SenoResponse(
        transcript=request.transcript,
        action=action
    )

    try:
        if action in LLM_ACTIONS:
            response_data.llm_response = await ask_llm(param, context=request.context, action=action)
        elif action in N8N_ACTIONS:
            result = await trigger_n8n(action, {"param": param})
            response_data.instruction = result 
        else:
            cmd = CommandResult(action=ActionType(action), raw=request.transcript, param=param)
            instruction = handle_action(cmd)
            response_data.instruction = instruction
            
    except Exception as e:
        logger.error(f"Error processing command {action}: {e}")
        response_data.error = str(e)
        
    return response_data

@router.post("/tts")
async def generate_tts(request: TTSRequest):
    """Converts requested text string to Streamed voice audio mp3 playback"""
    try:
        audio_bytes = await text_to_speech(request.text, request.voice)
        return StreamingResponse(io.BytesIO(audio_bytes), media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/transcribe")
async def transcribe_upload(file: UploadFile = File(...)):
    """Transcribes strictly uploaded audio file requests"""
    try:
        audio_bytes = await file.read()
        transcript = await transcribe_audio(audio_bytes, file.content_type)
        return {"transcript": transcript}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/voices")
async def get_voices():
    """Returns the list of Deepgram Aura-2 compatible voices based on SDK v5"""
    return [
      {"id": "aura-2-asteria-en", "name": "Asteria"},
      {"id": "aura-2-luna-en",    "name": "Luna"},
      {"id": "aura-2-stella-en",  "name": "Stella"},
      {"id": "aura-2-zeus-en",    "name": "Zeus"},
      {"id": "aura-2-orion-en",   "name": "Orion"},
      {"id": "aura-2-thalia-en",  "name": "Thalia"},
    ]

@router.post("/n8n/{action}")
async def n8n_trigger(action: str, payload: dict):
    """Direct local webhooks trigger API entry"""
    return await trigger_n8n(action.upper(), payload)

SUMMARIZE_SYSTEM_PROMPT = """You are Senorita, an AI coding assistant. Analyze this conversation between a developer and an AI assistant.
Return ONLY a valid JSON object (no markdown, no explanation, just the JSON) with this exact structure:

{
  "title": "Short descriptive session title",
  "overview": "2-3 sentence overview of what was accomplished",
  "intent_breakdown": [
    { "intent": "generate|refactor|explain|fix|test|document", "count": 2, "description": "What was done" }
  ],
  "key_actions": [
    { "step": 1, "action": "Short action label", "detail": "One sentence detail", "type": "user|ai|code" }
  ],
  "flowchart": "flowchart TD\\n    A[User Request] --> B{AI Analysis}\\n    B --> C[Code Generated]\\n    ...(full mermaid flowchart of the conversation flow, use proper mermaid syntax)",
  "code_changes": [
    { "heading": "Short title of the change e.g. Added error handler", "description": "One sentence describing exactly what was changed in the file", "action": "insert|replace_file|replace_selection|delete_lines", "filename": "filename.ext" }
  ],
  "code_topics": ["list", "of", "code", "topics", "discussed"],
  "insights": [
    { "icon": "emoji", "title": "Insight title", "body": "One sentence insight" }
  ],
  "stats": {
    "total_messages": 10,
    "user_messages": 5,
    "ai_messages": 5,
    "code_blocks": 3,
    "intents_used": ["generate", "explain"]
  }
}

For code_changes: use the actual file edits listed in the CODE CHANGES section if provided. If no code changes were made, return an empty array [].
Make the flowchart accurately represent the actual conversation flow. Use real node labels from the conversation. Keep the JSON strictly valid."""

@router.post("/summarize")
async def summarize_conversation(request: SummarizeRequest):
    """Summarizes a conversation into structured JSON with flowcharts and diagrams"""
    if not request.messages:
        raise HTTPException(status_code=400, detail="No messages to summarize")

    # Build conversation transcript for the LLM
    transcript_lines = []
    for msg in request.messages:
        role_label = "Developer" if msg.role == "user" else "AI Assistant"
        intent_tag = f" [{msg.intent}]" if msg.intent else ""
        transcript_lines.append(f"{role_label}{intent_tag}: {msg.text[:500]}")
    
    transcript = "\n".join(transcript_lines)
    context_note = f"\nActive file: {request.filename}" if request.filename else ""

    # Build code changes section
    changes_section = ""
    if request.code_changes:
        changes_lines = []
        for c in request.code_changes:
            changes_lines.append(f"- [{c.action.upper()}] {c.heading} in {c.filename}: {c.description}")
        changes_section = "\n\nCODE CHANGES MADE:\n" + "\n".join(changes_lines)
    
    prompt = f"Analyze this coding session conversation and return the structured JSON summary:{context_note}\n\n---\n{transcript}\n---{changes_section}"

    try:
        raw = await ask_llm(
            prompt=prompt,
            system_prompt=SUMMARIZE_SYSTEM_PROMPT,
            action="GENERATE_CODE",
            temperature=0.2,
            max_tokens=3000,
        )
        # Strip any markdown code fences if LLM added them
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("```", 2)[1]
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.rsplit("```", 1)[0].strip()

        summary = json.loads(cleaned)
        return {"ok": True, "summary": summary}
    except json.JSONDecodeError as e:
        logger.error(f"Summarize JSON parse error: {e}\nRaw: {raw[:500]}")
        raise HTTPException(status_code=500, detail=f"LLM returned invalid JSON: {str(e)}")
    except Exception as e:
        logger.error(f"Summarize error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def check_status():
    """Heartbeat system component endpoint checker"""
    return {
      "groq":     {"ok": True, "model": settings.GROQ_MODEL},
      "deepgram": {"ok": True, "sdk_version": "v5", "stt_model": settings.DEEPGRAM_STT_MODEL, "tts_voice": settings.DEEPGRAM_TTS_VOICE},
      "n8n":      {
          "email": bool(settings.N8N_EMAIL_WEBHOOK_URL), 
          "github": bool(settings.N8N_GITHUB_WEBHOOK_URL), 
          "slack": bool(settings.N8N_SLACK_WEBHOOK_URL)
      }
    }


# ─────────────────────────────────────────────────────────────────────────────
# File Registry API — Frontend registers files for context sharing
# ─────────────────────────────────────────────────────────────────────────────

class RegisterFileRequest(BaseModel):
    """Request to register a file"""
    filename: str
    path: str
    content: str
    language: Optional[str] = ""


class UnregisterFileRequest(BaseModel):
    """Request to unregister a file"""
    path: str


@router.post("/files/register")
async def register_file(request: RegisterFileRequest):
    """
    Register a file in the backend cache.
    Call this when a tab is opened or file content changes.
    """
    registry = get_file_registry()
    reg_file = registry.register(
        filename=request.filename,
        path=request.path,
        content=request.content,
        language=request.language or "",
    )
    return {
        "ok": True,
        "filename": reg_file.filename,
        "path": reg_file.path,
        "size": len(reg_file.content),
    }


@router.post("/files/unregister")
async def unregister_file(request: UnregisterFileRequest):
    """
    Unregister a file from the backend cache.
    Call this when a tab is closed.
    """
    registry = get_file_registry()
    removed = registry.unregister(request.path)
    return {"ok": removed, "path": request.path}


@router.get("/files/list")
async def list_registered_files():
    """Get list of all registered files"""
    registry = get_file_registry()
    files = registry.get_all()
    return {
        "ok": True,
        "files": [
            {
                "filename": f.filename,
                "path": f.path,
                "language": f.language,
                "size": len(f.content),
            }
            for f in files
        ],
    }


@router.get("/files/stats")
async def file_registry_stats():
    """Get file registry statistics"""
    registry = get_file_registry()
    return {"ok": True, **registry.stats()}


@router.post("/files/clear")
async def clear_file_registry():
    """Clear all registered files"""
    registry = get_file_registry()
    registry.clear()
    return {"ok": True}


@router.get("/files/get")
async def get_file_by_path(path: str):
    """Get a specific file's content by path"""
    registry = get_file_registry()
    
    # Search by exact path or filename match
    files = registry.search_by_filename(path.split("/")[-1].split("\\")[-1])
    
    # Try to find exact match first
    for f in files:
        if f.path == path or f.path.endswith(path) or path.endswith(f.path):
            return {
                "ok": True,
                "file": {
                    "filename": f.filename,
                    "path": f.path,
                    "content": f.content,
                    "language": f.language,
                }
            }
    
    # If no exact match, return first partial match
    if files:
        f = files[0]
        return {
            "ok": True,
            "file": {
                "filename": f.filename,
                "path": f.path,
                "content": f.content,
                "language": f.language,
            }
        }
    
    return {"ok": False, "file": None}


class RegisterFilesBatchRequest(BaseModel):
    """Request to register multiple files"""
    files: List[RegisterFileRequest]


@router.post("/files/register-batch")
async def register_files_batch(request: RegisterFilesBatchRequest):
    """
    Register multiple files in batch.
    Call this when a folder is opened to register all files.
    """
    registry = get_file_registry()
    count = 0
    
    for file_req in request.files:
        registry.register(
            filename=file_req.filename,
            path=file_req.path,
            content=file_req.content,
            language=file_req.language or "",
        )
        count += 1
    
    logger.info(f"[FileRegistry] Batch registered {count} files")
    return {"ok": True, "count": count}


@router.get("/files/list")
async def list_all_files():
    """
    List all registered files with their paths.
    Useful for debugging and for LLM to know what files exist.
    """
    registry = get_file_registry()
    files = registry.get_all()
    
    return {
        "ok": True,
        "count": len(files),
        "files": [
            {
                "filename": f.filename,
                "path": f.path,
                "language": f.language,
                "size": len(f.content),
            }
            for f in files
        ]
    }


@router.get("/files/search")
async def search_files(q: str):
    """
    Search for files by name (fuzzy matching).
    Returns matching files with their content.
    """
    registry = get_file_registry()
    
    # Search by filename
    results = registry.search_by_filename(q)
    
    # Also search in paths for folder/directory matches
    q_lower = q.lower().replace(" ", "").replace("_", "")
    for f in registry.get_all():
        path_lower = f.path.lower().replace("\\", "/")
        if q_lower in path_lower and f not in results:
            results.append(f)
    
    return {
        "ok": True,
        "count": len(results),
        "files": [
            {
                "filename": f.filename,
                "path": f.path,
                "language": f.language,
                "content": f.content[:5000] if len(f.content) > 5000 else f.content,  # Limit content size
                "truncated": len(f.content) > 5000,
            }
            for f in results[:10]  # Limit to 10 results
        ]
    }


# ─────────────────────────────────────────────────────────────────────────────
# Project Root API — Set the project root for filesystem-based context retrieval
# ─────────────────────────────────────────────────────────────────────────────

class SetProjectRootRequest(BaseModel):
    """Request to set the project root path"""
    path: str


@router.post("/project/set-root")
async def set_project_root_endpoint(request: SetProjectRootRequest):
    """
    Set the project root path for filesystem-based file discovery.
    Call this when opening a project folder.
    """
    import os
    path = request.path
    
    if not path:
        return {"ok": False, "error": "No path provided"}
    
    if not os.path.isdir(path):
        return {"ok": False, "error": f"Path does not exist: {path}"}
    
    set_project_root(path)
    
    # Also index the project for symbol search
    try:
        indexer = get_indexer()
        count = indexer.index_project(path)
        logger.info(f"Indexed {count} files from project root: {path}")
    except Exception as e:
        logger.warning(f"Project indexing failed: {e}")
    
    return {"ok": True, "path": path, "message": f"Project root set to {path}"}


@router.get("/project/root")
async def get_project_root_endpoint():
    """Get the current project root path"""
    root = get_project_root()
    return {"ok": True, "path": root}


# ─────────────────────────────────────────────────────────────────────────────
# Chat History & Memory API — Conversation persistence and switching
# ─────────────────────────────────────────────────────────────────────────────

class CreateConversationRequest(BaseModel):
    """Request to create a new conversation"""
    title: str = "New Conversation"
    project_root: str = ""


class AddMemoryRequest(BaseModel):
    """Request to add a memory"""
    category: str
    content: str
    importance: float = 1.0


@router.post("/conversations/create")
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation session"""
    memory_service = get_memory_service()
    conv = memory_service.create_conversation(
        title=request.title,
        project_root=request.project_root,
    )
    return {
        "ok": True,
        "conversation": {
            "id": conv.id,
            "title": conv.title,
            "created_at": conv.created_at,
        }
    }


@router.get("/conversations/list")
async def list_conversations():
    """List all conversations"""
    memory_service = get_memory_service()
    conversations = memory_service.list_conversations()
    return {"ok": True, "conversations": conversations}


@router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    """Get a specific conversation with its messages"""
    memory_service = get_memory_service()
    conv = memory_service.get_conversation(conv_id)
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {
        "ok": True,
        "conversation": {
            "id": conv.id,
            "title": conv.title,
            "created_at": conv.created_at,
            "updated_at": conv.updated_at,
            "messages": [
                {
                    "role": msg.role,
                    "content": msg.content,
                    "timestamp": msg.timestamp,
                    "metadata": msg.metadata,
                }
                for msg in conv.messages
            ],
        }
    }


@router.post("/conversations/{conv_id}/switch")
async def switch_conversation(conv_id: str):
    """Switch to a different conversation"""
    memory_service = get_memory_service()
    success = memory_service.set_active_conversation(conv_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {"ok": True, "active_conversation": conv_id}


@router.delete("/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    """Delete a conversation"""
    memory_service = get_memory_service()
    success = memory_service.delete_conversation(conv_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {"ok": True}


@router.get("/conversations/active")
async def get_active_conversation():
    """Get the currently active conversation"""
    memory_service = get_memory_service()
    conv = memory_service.get_active_conversation()
    
    if not conv:
        return {"ok": True, "conversation": None}
    
    return {
        "ok": True,
        "conversation": {
            "id": conv.id,
            "title": conv.title,
            "message_count": len(conv.messages),
        }
    }


@router.get("/conversations/{conv_id}/export")
async def export_conversation(conv_id: str):
    """Export a conversation as JSON"""
    memory_service = get_memory_service()
    data = memory_service.export_conversation(conv_id)
    
    if not data:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {"ok": True, "data": data}


# ─────────────────────────────────────────────────────────────────────────────
# Memory API — Long-term memory management
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/memory/add")
async def add_memory(request: AddMemoryRequest):
    """Add a new memory"""
    memory_service = get_memory_service()
    memory = memory_service.add_memory(
        category=request.category,
        content=request.content,
        importance=request.importance,
    )
    return {
        "ok": True,
        "memory": {
            "id": memory.id,
            "category": memory.category,
            "content": memory.content,
        }
    }


@router.get("/memory/list")
async def list_memories(category: Optional[str] = None, limit: int = 20):
    """List memories, optionally filtered by category"""
    memory_service = get_memory_service()
    memories = memory_service.get_memories(category=category, limit=limit)
    return {
        "ok": True,
        "memories": [
            {
                "id": m.id,
                "category": m.category,
                "content": m.content,
                "importance": m.importance,
                "created_at": m.created_at,
            }
            for m in memories
        ]
    }


@router.get("/memory/search")
async def search_memories(q: str, limit: int = 10):
    """Search memories by content"""
    memory_service = get_memory_service()
    memories = memory_service.search_memories(q, limit=limit)
    return {
        "ok": True,
        "memories": [
            {
                "id": m.id,
                "category": m.category,
                "content": m.content,
                "importance": m.importance,
            }
            for m in memories
        ]
    }


@router.delete("/memory/{memory_id}")
async def delete_memory(memory_id: str):
    """Delete a memory"""
    memory_service = get_memory_service()
    success = memory_service.delete_memory(memory_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Memory not found")
    
    return {"ok": True}


@router.get("/memory/stats")
async def memory_stats():
    """Get memory service statistics"""
    memory_service = get_memory_service()
    return {"ok": True, **memory_service.stats()}


# ─────────────────────────────────────────────────────────────────────────────
# Index API — Symbol indexer and embedding service status
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/index/project")
async def index_project(project_root: str):
    """Index a project for symbol search"""
    try:
        indexer = get_indexer()
        count = indexer.index_project(project_root)
        
        # Also index symbols for embedding search
        try:
            embedding_service = get_embedding_service()
            all_symbols = []
            for file_symbols in indexer.index.by_file.values():
                for sym in file_symbols.symbols:
                    all_symbols.append({
                        "name": sym.name,
                        "kind": sym.kind,
                        "file_path": sym.file_path,
                        "line": sym.line,
                        "signature": sym.signature,
                        "docstring": sym.docstring,
                    })
            embedding_service.index_symbols(all_symbols)
        except Exception as e:
            logger.warning(f"Embedding indexing failed: {e}")
        
        return {
            "ok": True,
            "files_indexed": count,
            "summary": indexer.get_project_summary(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/index/stats")
async def index_stats():
    """Get indexer statistics"""
    indexer = get_indexer()
    embedding_service = get_embedding_service()
    
    return {
        "ok": True,
        "symbol_index": indexer.get_project_summary(),
        "embedding_index": embedding_service.stats(),
    }


@router.get("/index/search")
async def search_symbols(q: str, limit: int = 20, semantic: bool = False):
    """Search for symbols by name or semantically"""
    indexer = get_indexer()
    
    if semantic:
        embedding_service = get_embedding_service()
        results = embedding_service.search_symbols(q, top_k=limit)
        return {
            "ok": True,
            "results": [
                {
                    "name": r.metadata.get("name"),
                    "kind": r.metadata.get("kind"),
                    "file_path": r.metadata.get("file_path"),
                    "line": r.metadata.get("line"),
                    "score": r.score,
                }
                for r in results
            ]
        }
    else:
        symbols = indexer.search_symbols(q, limit=limit)
        return {
            "ok": True,
            "results": [
                {
                    "name": s.name,
                    "kind": s.kind,
                    "file_path": s.file_path,
                    "line": s.line,
                    "signature": s.signature,
                }
                for s in symbols
            ]
        }


@router.get("/index/callers/{symbol_name}")
async def get_symbol_callers(symbol_name: str):
    """Get all functions that call a given symbol"""
    indexer = get_indexer()
    callers = indexer.get_callers(symbol_name)
    
    return {
        "ok": True,
        "symbol": symbol_name,
        "callers": [
            {
                "name": c.name,
                "kind": c.kind,
                "file_path": c.file_path,
                "line": c.line,
            }
            for c in callers
        ]
    }


@router.get("/index/callees/{symbol_name}")
async def get_symbol_callees(symbol_name: str):
    """Get all functions that a given symbol calls"""
    indexer = get_indexer()
    callees = indexer.get_callees(symbol_name)
    
    return {
        "ok": True,
        "symbol": symbol_name,
        "callees": [
            {
                "name": c.name,
                "kind": c.kind,
                "file_path": c.file_path,
                "line": c.line,
            }
            for c in callees
        ]
    }
