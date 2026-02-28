"""
Planning Agent — Breaks down complex tasks into executable steps with multi-iteration retrieval.

This agent handles complex, multi-step coding tasks by:
1. Analyzing the user's request
2. Breaking it into discrete steps
3. Iteratively retrieving context for each step
4. Coordinating with other agents (Coding, Debug) to execute steps

Like real IDEs (Cursor, Copilot), it can:
- Plan multi-file changes
- Retrieve additional context as needed
- Re-plan based on intermediate results
"""
import logging
import json
import re
from typing import TypedDict, Literal, Optional
from dataclasses import dataclass, field

from app.services.groq_service import ask_llm
from app.services.symbol_indexer import get_indexer, Symbol
from app.services.embedding_service import get_embedding_service, hybrid_search
from app.agents.context_agent import FileContext, get_context

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Data Structures
# ─────────────────────────────────────────────────────────────────────────────

StepStatus = Literal["pending", "in_progress", "completed", "failed", "skipped"]
StepType = Literal["retrieve", "analyze", "code", "debug", "test", "refactor", "create_file", "modify_file"]


@dataclass
class PlanStep:
    """A single step in the execution plan"""
    id: int
    type: StepType
    description: str
    target_file: Optional[str] = None      # File to operate on
    target_symbol: Optional[str] = None    # Symbol to focus on
    dependencies: list[int] = field(default_factory=list)  # Step IDs this depends on
    status: StepStatus = "pending"
    result: Optional[dict] = None          # Result after execution
    context_gathered: Optional[dict] = None  # Context retrieved for this step


@dataclass
class ExecutionPlan:
    """Complete execution plan for a complex task"""
    task_description: str
    steps: list[PlanStep]
    current_step: int = 0
    iteration: int = 1
    max_iterations: int = 5
    status: Literal["planning", "executing", "completed", "failed"] = "planning"
    final_result: Optional[dict] = None


class PlanResult(TypedDict):
    """Result returned by the planning agent"""
    plan: dict                    # The execution plan
    steps_completed: int
    total_steps: int
    current_step_result: Optional[dict]
    needs_more_context: bool
    suggested_retrieval: Optional[list[str]]  # Symbols/files to retrieve
    explanation: str


# ─────────────────────────────────────────────────────────────────────────────
# Planning Prompts
# ─────────────────────────────────────────────────────────────────────────────

PLANNING_SYSTEM_PROMPT = """You are a planning agent for an AI coding assistant. Your job is to break down complex coding tasks into discrete, executable steps.

For each task, create a plan with steps that can be executed sequentially. Each step should be one of:
- retrieve: Gather more context about specific files/symbols
- analyze: Understand existing code structure
- code: Generate or modify code
- debug: Fix bugs or errors
- test: Create or run tests
- refactor: Improve code structure
- create_file: Create a new file
- modify_file: Modify an existing file

Output your plan as JSON with this structure:
{
    "task_summary": "Brief summary of what needs to be done",
    "steps": [
        {
            "id": 1,
            "type": "retrieve|analyze|code|debug|test|refactor|create_file|modify_file",
            "description": "What this step does",
            "target_file": "path/to/file.py or null",
            "target_symbol": "function_name or null",
            "dependencies": [list of step IDs this depends on]
        }
    ],
    "estimated_complexity": "low|medium|high",
    "files_involved": ["list", "of", "files"]
}

Keep plans concise - typically 3-7 steps. For simple tasks, 1-2 steps is fine.
Always start with a retrieve step if you need more context about the codebase."""

RETRIEVAL_DECISION_PROMPT = """Based on the current context and the next step in the plan, decide if more context is needed.

Current step: {step_description}
Target file: {target_file}
Target symbol: {target_symbol}

Available context:
- Current file symbols: {current_symbols}
- Related symbols: {related_symbols}
- Call graph for target: {call_graph}

Do you need more context to execute this step? If yes, what specific symbols or files should be retrieved?

Output JSON:
{
    "needs_more_context": true|false,
    "retrieve_symbols": ["symbol1", "symbol2"],
    "retrieve_files": ["file1.py", "file2.py"],
    "reason": "Why this context is needed"
}"""


# ─────────────────────────────────────────────────────────────────────────────
# Planning Agent
# ─────────────────────────────────────────────────────────────────────────────

async def create_plan(
    transcript: str,
    context: FileContext,
    existing_plan: Optional[ExecutionPlan] = None,
) -> ExecutionPlan:
    """
    Create or update an execution plan for a complex task.
    
    Args:
        transcript: User's voice command
        context: Current file context
        existing_plan: Optional existing plan to update/continue
    
    Returns:
        ExecutionPlan with steps to execute
    """
    # If we have an existing plan that's still valid, continue it
    if existing_plan and existing_plan.status == "executing":
        return existing_plan
    
    # Build context summary for the LLM
    context_summary = _build_context_summary(context)
    
    prompt = f"""Create an execution plan for this task:

User request: "{transcript}"

Current context:
{context_summary}

Create a step-by-step plan to accomplish this task."""

    response = await ask_llm(
        prompt=prompt,
        system_prompt=PLANNING_SYSTEM_PROMPT,
        temperature=0.2,
        max_tokens=2048,
    )
    
    # Parse the plan from LLM response
    plan = _parse_plan_response(response, transcript)
    
    logger.info(f"Planning Agent: created plan with {len(plan.steps)} steps")
    return plan


async def execute_step(
    plan: ExecutionPlan,
    context: FileContext,
    step_index: Optional[int] = None,
) -> tuple[ExecutionPlan, PlanResult]:
    """
    Execute the next step (or specified step) in the plan.
    
    This implements multi-iteration retrieval:
    1. Check if current context is sufficient
    2. If not, retrieve more context
    3. Execute the step
    4. Update plan status
    
    Args:
        plan: The execution plan
        context: Current file context
        step_index: Optional specific step to execute (defaults to current_step)
    
    Returns:
        Tuple of (updated_plan, step_result)
    """
    idx = step_index if step_index is not None else plan.current_step
    
    if idx >= len(plan.steps):
        plan.status = "completed"
        return plan, PlanResult(
            plan=_plan_to_dict(plan),
            steps_completed=len(plan.steps),
            total_steps=len(plan.steps),
            current_step_result=None,
            needs_more_context=False,
            suggested_retrieval=None,
            explanation="All steps completed.",
        )
    
    step = plan.steps[idx]
    step.status = "in_progress"
    
    # Check if we need more context for this step
    needs_context, retrieval_suggestions = await _check_context_needs(step, context)
    
    if needs_context and plan.iteration < plan.max_iterations:
        # Need more context - return with retrieval suggestions
        plan.iteration += 1
        return plan, PlanResult(
            plan=_plan_to_dict(plan),
            steps_completed=idx,
            total_steps=len(plan.steps),
            current_step_result=None,
            needs_more_context=True,
            suggested_retrieval=retrieval_suggestions,
            explanation=f"Need more context for step {idx + 1}: {step.description}",
        )
    
    # Execute the step based on its type
    step_result = await _execute_step_by_type(step, context)
    
    # Update step status
    step.status = "completed" if step_result.get("success", True) else "failed"
    step.result = step_result
    
    # Move to next step
    plan.current_step = idx + 1
    if plan.current_step >= len(plan.steps):
        plan.status = "completed"
    
    return plan, PlanResult(
        plan=_plan_to_dict(plan),
        steps_completed=plan.current_step,
        total_steps=len(plan.steps),
        current_step_result=step_result,
        needs_more_context=False,
        suggested_retrieval=None,
        explanation=f"Completed step {idx + 1}: {step.description}",
    )


async def iterate_retrieval(
    plan: ExecutionPlan,
    context: FileContext,
    retrieval_targets: list[str],
    project_root: str = "",
) -> FileContext:
    """
    Perform additional retrieval iteration to gather more context.
    
    This is the key to multi-iteration retrieval like real IDEs:
    - Search for symbols mentioned in retrieval_targets
    - Get their code context
    - Add to the existing context
    
    Args:
        plan: Current execution plan
        context: Existing context
        retrieval_targets: Symbols/files to retrieve
        project_root: Project root for file operations
    
    Returns:
        Enhanced FileContext with additional information
    """
    indexer = get_indexer()
    embedding_service = get_embedding_service()
    
    additional_snippets = []
    additional_files = []
    
    for target in retrieval_targets:
        # Try symbol search first
        symbols = indexer.search_symbols(target, limit=5)
        
        if not symbols:
            # Try semantic search
            semantic_results = embedding_service.search_symbols(target, top_k=5)
            for result in semantic_results:
                if result.score > 0.5:  # Only high-confidence matches
                    symbols.extend(indexer.find_symbol(result.metadata.get("name", "")))
        
        # Get code context for found symbols
        for sym in symbols[:3]:  # Limit to top 3 per target
            code = indexer.get_context_for_symbol(sym, context_lines=15)
            if code:
                additional_snippets.append({
                    "symbol_name": sym.name,
                    "kind": sym.kind,
                    "file_path": sym.file_path,
                    "line": sym.line,
                    "code": code[:2000],
                })
            
            # Also get call graph context
            callers = indexer.get_callers(sym.name)
            for caller in callers[:2]:
                caller_code = indexer.get_context_for_symbol(caller, context_lines=5)
                if caller_code:
                    additional_snippets.append({
                        "symbol_name": f"{caller.name} (calls {sym.name})",
                        "kind": caller.kind,
                        "file_path": caller.file_path,
                        "line": caller.line,
                        "code": caller_code[:1000],
                    })
    
    # Merge additional context into existing context
    existing_snippets = context.get("relevant_snippets", [])
    context["relevant_snippets"] = existing_snippets + additional_snippets
    
    existing_files = context.get("referenced_files", [])
    context["referenced_files"] = existing_files + additional_files
    
    logger.info(f"Planning Agent: retrieved {len(additional_snippets)} additional snippets")
    return context


# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

def _build_context_summary(context: FileContext) -> str:
    """Build a concise summary of the current context for the LLM"""
    parts = []
    
    # Current file info
    file_path = context.get("file_path", "unknown")
    language = context.get("language", "unknown")
    parts.append(f"Current file: {file_path} ({language})")
    
    # Symbols in file
    symbols = context.get("symbols_in_file", [])
    if symbols:
        symbol_list = ", ".join([f"{s['kind']} {s['name']}" for s in symbols[:10]])
        parts.append(f"Symbols: {symbol_list}")
    
    # Selected code
    selected = context.get("selected_code", "")
    if selected:
        parts.append(f"Selected code:\n```\n{selected[:500]}\n```")
    
    # Project structure
    structure = context.get("project_structure", "")
    if structure:
        parts.append(f"Project structure:\n{structure[:1000]}")
    
    return "\n\n".join(parts)


def _parse_plan_response(response: str, task_description: str) -> ExecutionPlan:
    """Parse LLM response into ExecutionPlan"""
    # Try to extract JSON from response
    json_str = response.strip()
    
    # Remove markdown code blocks if present
    if json_str.startswith("```"):
        match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", json_str, re.DOTALL)
        if match:
            json_str = match.group(1).strip()
    
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse plan JSON: {e}")
        # Create a simple default plan
        return ExecutionPlan(
            task_description=task_description,
            steps=[
                PlanStep(
                    id=1,
                    type="code",
                    description=task_description,
                )
            ],
            status="executing",
        )
    
    # Build steps from parsed data
    steps = []
    for i, step_data in enumerate(data.get("steps", [])):
        steps.append(PlanStep(
            id=step_data.get("id", i + 1),
            type=step_data.get("type", "code"),
            description=step_data.get("description", ""),
            target_file=step_data.get("target_file"),
            target_symbol=step_data.get("target_symbol"),
            dependencies=step_data.get("dependencies", []),
        ))
    
    if not steps:
        # Fallback: create single step
        steps = [PlanStep(id=1, type="code", description=task_description)]
    
    return ExecutionPlan(
        task_description=data.get("task_summary", task_description),
        steps=steps,
        status="executing",
    )


async def _check_context_needs(step: PlanStep, context: FileContext) -> tuple[bool, list[str]]:
    """Check if more context is needed for a step"""
    # For retrieve steps, always need to do retrieval
    if step.type == "retrieve":
        targets = []
        if step.target_symbol:
            targets.append(step.target_symbol)
        if step.target_file:
            targets.append(step.target_file)
        return True, targets
    
    # For other steps, check if we have enough context
    indexer = get_indexer()
    
    # If targeting a specific symbol, check if we have it
    if step.target_symbol:
        symbols = indexer.find_symbol(step.target_symbol)
        if not symbols:
            return True, [step.target_symbol]
    
    # If targeting a specific file, check if we have its content
    if step.target_file:
        current_file = context.get("file_path", "")
        if step.target_file not in current_file:
            # Check if it's in referenced files
            referenced = context.get("referenced_files", [])
            if not any(step.target_file in ref.get("path", "") for ref in referenced):
                return True, [step.target_file]
    
    return False, []


async def _execute_step_by_type(step: PlanStep, context: FileContext) -> dict:
    """Execute a step based on its type"""
    if step.type == "retrieve":
        # Retrieval is handled separately
        return {"success": True, "type": "retrieve", "message": "Context retrieved"}
    
    elif step.type == "analyze":
        # Analysis step - use LLM to analyze code
        code_to_analyze = context.get("selected_code") or context.get("surrounding_lines", "")
        
        analysis = await ask_llm(
            prompt=f"Analyze this code for: {step.description}\n\n```\n{code_to_analyze[:3000]}\n```",
            system_prompt="You are a code analyst. Provide clear, concise analysis.",
            temperature=0.3,
            max_tokens=1024,
        )
        
        return {"success": True, "type": "analyze", "analysis": analysis}
    
    elif step.type in ("code", "create_file", "modify_file"):
        # Code generation - will be handled by coding agent
        return {
            "success": True,
            "type": step.type,
            "action": "delegate_to_coding_agent",
            "description": step.description,
            "target_file": step.target_file,
        }
    
    elif step.type == "debug":
        # Debug - will be handled by debug agent
        return {
            "success": True,
            "type": "debug",
            "action": "delegate_to_debug_agent",
            "description": step.description,
        }
    
    elif step.type == "refactor":
        # Refactoring - similar to code modification
        return {
            "success": True,
            "type": "refactor",
            "action": "delegate_to_coding_agent",
            "description": step.description,
            "target_file": step.target_file,
            "target_symbol": step.target_symbol,
        }
    
    elif step.type == "test":
        # Test creation/execution
        return {
            "success": True,
            "type": "test",
            "action": "delegate_to_coding_agent",
            "description": f"Create tests: {step.description}",
        }
    
    return {"success": False, "error": f"Unknown step type: {step.type}"}


def _plan_to_dict(plan: ExecutionPlan) -> dict:
    """Convert ExecutionPlan to dictionary for JSON serialization"""
    return {
        "task_description": plan.task_description,
        "steps": [
            {
                "id": step.id,
                "type": step.type,
                "description": step.description,
                "target_file": step.target_file,
                "target_symbol": step.target_symbol,
                "status": step.status,
                "result": step.result,
            }
            for step in plan.steps
        ],
        "current_step": plan.current_step,
        "iteration": plan.iteration,
        "status": plan.status,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def planning_agent(
    transcript: str,
    context: FileContext,
    existing_plan: Optional[dict] = None,
    project_root: str = "",
) -> PlanResult:
    """
    Main entry point for the Planning Agent.
    
    Handles complex, multi-step tasks by:
    1. Creating an execution plan
    2. Iteratively retrieving context
    3. Executing steps
    4. Returning results
    
    Args:
        transcript: User's voice command
        context: Current file context
        existing_plan: Optional existing plan to continue
        project_root: Project root directory
    
    Returns:
        PlanResult with plan status and results
    """
    # Convert existing plan dict back to ExecutionPlan if provided
    plan = None
    if existing_plan:
        plan = _dict_to_plan(existing_plan)
    
    # Create or continue plan
    if plan is None or plan.status == "completed":
        plan = await create_plan(transcript, context)
    
    # Execute next step
    plan, result = await execute_step(plan, context)
    
    # If we need more context, do retrieval iteration
    if result["needs_more_context"] and result["suggested_retrieval"]:
        context = await iterate_retrieval(
            plan, context, result["suggested_retrieval"], project_root
        )
        # Try executing again with enhanced context
        plan, result = await execute_step(plan, context)
    
    return result


def _dict_to_plan(data: dict) -> ExecutionPlan:
    """Convert dictionary back to ExecutionPlan"""
    steps = []
    for step_data in data.get("steps", []):
        steps.append(PlanStep(
            id=step_data.get("id", 0),
            type=step_data.get("type", "code"),
            description=step_data.get("description", ""),
            target_file=step_data.get("target_file"),
            target_symbol=step_data.get("target_symbol"),
            status=step_data.get("status", "pending"),
            result=step_data.get("result"),
        ))
    
    return ExecutionPlan(
        task_description=data.get("task_description", ""),
        steps=steps,
        current_step=data.get("current_step", 0),
        iteration=data.get("iteration", 1),
        status=data.get("status", "executing"),
    )
