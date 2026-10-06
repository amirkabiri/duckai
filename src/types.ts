import { ChatCompletionContentPart } from "openai/src/resources.js";
import { ChatCompletionReasoningEffort } from "openai/src/resources/chat/completions.js";
import { DuckAIReasoningEffort } from "./models";

// OpenAI API Types
type ChatCompletionMessageRole =
  | "system"
  | "developer"
  | "user"
  | "assistant"
  | "tool";

type BaseChatCompletionMessage<ContentPart> = {
  role: ChatCompletionMessageRole;
  content: string | ContentPart[] | null;
  reasoning_content?: string;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type ChatCompletionMessage =
  BaseChatCompletionMessage<ChatCompletionContentPart>;
export type DuckChatCompletionMessage =
  BaseChatCompletionMessage<DuckChatCompletionContentPart>;

// what duckduckgo accepts based on openai ChatCompletionContentPart types
export interface DuckChatCompletionContentPartText {
  text: string;
  type: "text";
}

export interface DuckChatCompletionContentPartImage {
  image: string;
  mimeType: string;
  type: "image";
}

export interface DuckChatCompletionContentPartFile {
  content: string;
  encoding: string;
  filename: string;
  mimeType: string;
  type: "file";
}

export type DuckChatCompletionContentPart =
  | DuckChatCompletionContentPartText
  | DuckChatCompletionContentPartImage
  | DuckChatCompletionContentPartFile;

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters?: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolDefinition {
  type: "function";
  function: FunctionDefinition;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  metadata?: DuckAIMetadata;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice;
  reasoning_effort: DuckAIReasoningEffort;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionMessage;
  finish_reason: "stop" | "length" | "content_filter" | "tool_calls" | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionStreamChoice {
  index: number;
  delta: {
    role?: "assistant";
    content?: string;
    reasoning_content?: string;
    tool_calls?: ToolCall[];
  };
  finish_reason: "stop" | "length" | "content_filter" | "tool_calls" | null;
}

export interface ChatCompletionStreamResponse {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionStreamChoice[];
}

export interface Model {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  object: "list";
  data: Model[];
}

// Duck.ai specific types
export interface VQDResponse {
  // vqd: string; // looks unused to me
  hash: string;
}

export interface DuckAIMetadata {
  customization: {
    additionalInstructions: string;
    shouldSeekClarity: boolean;
  };
  toolChoice: {
    NewsSearch: boolean;
    VideosSearch: boolean;
    LocalSearch: boolean;
    WeatherForecast: boolean;
  };
}

export interface DuckAIRequest {
  model: string;
  messages: DuckChatCompletionMessage[];
  metadata?: DuckAIMetadata;
  reasoningEffort?: DuckAIReasoningEffort;
  canUseTools: boolean;
}

export interface DuckAIChatResult {
  content: string;
  reasoning?: string;
}

export type DuckAIStreamChunk =
  | { type: "content"; text: string }
  | { type: "reasoning"; text: string };
