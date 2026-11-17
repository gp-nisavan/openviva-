export interface TOCItem {
  id: string;
  title: string;
  section_number?: string;
  level: number; // 1 to 5
  page: number; // 1-indexed page
  bbox: [number, number, number, number]; // [x0, y0, x1, y1] spatial coordinates in points
  selected?: boolean;
  comment?: string;
  children?: TOCItem[];
}

export interface DocumentTOCResponse {
  filename: string;
  total_pages: number;
  extraction_mode: string;
  total_items: number;
  items: TOCItem[];
}

export type RigorTier =
  | "undergrad_1"
  | "undergrad_2"
  | "undergrad_3"
  | "undergrad_4"
  | "grad"
  | "advanced";

export interface SystemPromptRequest {
  course_title?: string;
  selected_chapters: string[];
  items: TOCItem[];
  tree?: any[];
  global_directive?: string;
  student_decides_weightage?: boolean;
  difficulty?: RigorTier | string;
  duration_minutes?: number;
  exemplar_probes?: { topic: string; starter: string; followUp: string; pinned?: boolean }[];
}

export interface SystemPromptResponse {
  system_prompt: string;
  selected_count: number;
  estimated_tokens?: number;
}
