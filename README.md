# checks-if-website-up-agent

an agent that checks if a website is up and returns its status code

built and deployed with [tryeve](https://tryeve.abhivarde.in), an agent runtime for [eve](https://eve.dev).

## before this works

add a model credential in this project's vercel settings, then redeploy:

```
AI_GATEWAY_API_KEY=
```

or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. one AI Gateway key covers anthropic, openai, gemini, groq, and more.
