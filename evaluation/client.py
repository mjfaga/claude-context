import asyncio
from langgraph.prebuilt import create_react_agent
from utils.format import (
    extract_conversation_summary,
    extract_file_paths_from_edits,
    calculate_total_tokens,
)


class Evaluator:
    def __init__(self, llm_model, tools):
        self.llm_model = llm_model
        self.tools = tools
        self.agent = create_react_agent(self.llm_model, self.tools)

        try:
            self.loop = asyncio.get_event_loop()
        except RuntimeError:
            self.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.loop)

    async def async_run(self, query, codebase_path=None):
        response = await self.agent.ainvoke(
            {"messages": [{"role": "user", "content": query}]},
            config={"recursion_limit": 150},
        )

        conversation_summary, tool_stats = extract_conversation_summary(response)
        token_usage = calculate_total_tokens(response)

        if codebase_path:
            file_paths = extract_file_paths_from_edits(response, codebase_path)
        else:
            file_paths = []

        return conversation_summary, token_usage, file_paths, tool_stats

    def run(self, query: str, codebase_path=None):
        return asyncio.run(self.async_run(query, codebase_path))
