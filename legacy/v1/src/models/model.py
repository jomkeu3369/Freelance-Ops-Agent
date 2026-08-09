from langgraph.graph import StateGraph, START, END
from langgraph.constants import Send
from langgraph.checkpoint.memory import MemorySaver

from src.logs.log import get_logger
from src.models.schema import MainState
from src.models.nodes import (
    clariffication_node, clariffication_feedback_node, risk_assessment_node, 
    modification_proposal_node, modification_feedback_node,
    query_generation_node, workspace_node,
    estimation_node, hallucination_check_node, estimation_hitl_node, finalize_and_store_node
)

logger = get_logger()
memory = MemorySaver()

main_workflow = StateGraph(MainState)

main_workflow.add_node("clariffication", clariffication_node)
main_workflow.add_node("clariffication_feedback", clariffication_feedback_node)
main_workflow.add_node("risk_assessment", risk_assessment_node)
main_workflow.add_node("modification_proposal", modification_proposal_node)
main_workflow.add_node("modification_feedback", modification_feedback_node)
main_workflow.add_node("query_generation", query_generation_node)
main_workflow.add_node("workspace_node", workspace_node)
main_workflow.add_node("estimation", estimation_node)
main_workflow.add_node("hallucination_check", hallucination_check_node)
main_workflow.add_node("estimation_hitl", estimation_hitl_node)
main_workflow.add_node("finalize_and_store", finalize_and_store_node)

main_workflow.add_edge(START, "clariffication")

def check_sufficiency(state: MainState) -> str:
    if state.get("is_sufficient"):
        return "risk_assessment"
    else:
        return "clariffication_feedback"

main_workflow.add_conditional_edges("clariffication", check_sufficiency)
main_workflow.add_edge("clariffication_feedback", "clariffication")

def check_risk_level(state: MainState) -> str:
    law_risk = state.get("korean_law_risk", 0.0)
    tos_risk = state.get("discord_tos_risk", 0.0)
    
    if law_risk >= 0.6 or tos_risk >= 0.6:
        return "modification_proposal"

    return "query_generation"

main_workflow.add_conditional_edges("risk_assessment", check_risk_level)

def check_recoverability(state: MainState) -> str:
    if not state.get("is_recoverable"):
        return END
    return "modification_feedback"

main_workflow.add_conditional_edges("modification_proposal", check_recoverability)

def route_after_modification(state: MainState) -> str:
    if state.get("project_status") == "STOP":
        return END 
    return "risk_assessment"

main_workflow.add_conditional_edges("modification_feedback", route_after_modification)

def map_to_workspaces(state: MainState) -> list[Send]:
    queries = state.get("search_queries", [])
    
    return [
        Send("workspace_node", {
            "input_message": state["input_message"], 
            "current_query": query
        }) 
        for query in queries
    ]

main_workflow.add_conditional_edges("query_generation", map_to_workspaces)

main_workflow.add_edge("workspace_node", "estimation")
main_workflow.add_edge("estimation", "hallucination_check")


def check_hallucination(state: MainState) -> str:
    score = state.get("hallucination_score", 0.0)
    retry = state.get("estimation_retry_count", 0)
    
    if score >= 0.8 or retry >= 3:
        return "estimation_hitl"
    return "estimation"

main_workflow.add_conditional_edges("hallucination_check", check_hallucination)

def route_after_estimation_hitl(state: MainState) -> str:
    status = state.get("project_status")
    
    if status == "STOP":
        return END
    elif status == "ACCEPT":
        return "finalize_and_store"
        
    return "estimation"

main_workflow.add_conditional_edges("estimation_hitl", route_after_estimation_hitl)
main_workflow.add_edge("finalize_and_store", END)

graph = main_workflow.compile(
    checkpointer=memory, 
    interrupt_before=[
        "clariffication_feedback", 
        "modification_feedback", 
        "estimation_hitl"
    ]
)