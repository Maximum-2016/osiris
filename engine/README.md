# Engine

The Python prediction loop is not part of this fork.

Upstream kept only compiled `__pycache__` bytecode here and no `.py` sources. Those files were inspected by reading their constant strings and names. They were not executed. The strings describe a local oracle that reads this app on localhost and a local LLM, and that can POST to webhooks an operator registers. No wallet, miner, or remote script download showed up.

The bytecode is not included, so nothing in this directory runs. On Vercel there is no long-running Python process. Forecasts in the dashboard are the TypeScript implementation under `src/lib/oi`, which uses a model key the visitor supplies in the browser.
