import { ToolLoopAgent, stepCountIs } from "ai";

const cwd = process.argv[2] || process.cwd();

const agent = new ToolLoopAgent({
  model: "google/gemini-2.5-flash",
  instructions: `You are a coding agent.\nWorking directory: ${cwd}`,
  tools: {},
  stopWhen: stepCountIs(10),
});

const prompt = process.argv.slice(3).join(" ") || "Hello!";
const { text, steps } = await agent.generate({ prompt });

console.log(text);
console.log(`\n(${steps.length} steps)`);
