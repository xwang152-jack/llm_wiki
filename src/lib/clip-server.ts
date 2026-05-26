import type { WikiProject } from "@/types/wiki"

export const CLIP_SERVER_HOST = "127.0.0.1"
export const CLIP_SERVER_PORT = 19827
export const CLIP_SERVER_BASE_URL = `http://${CLIP_SERVER_HOST}:${CLIP_SERVER_PORT}`

interface ClipServerResponse {
  ok?: boolean
}

export interface PendingClip {
  projectPath: string
  filePath: string
}

interface PendingClipsResponse extends ClipServerResponse {
  clips?: PendingClip[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CLIP_SERVER_BASE_URL}${path}`, init)
  return response.json() as Promise<T>
}

export async function fetchPendingClips(): Promise<PendingClip[]> {
  const data = await request<PendingClipsResponse>("/clips/pending", { method: "GET" })
  if (!data.ok || !Array.isArray(data.clips)) return []
  return data.clips
}

export async function setCurrentClipProject(projectPath: string): Promise<void> {
  await request<ClipServerResponse>("/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: projectPath }),
  })
}

export async function syncClipProjects(projects: WikiProject[]): Promise<void> {
  await request<ClipServerResponse>("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projects: projects.map((project) => ({
        name: project.name,
        path: project.path,
      })),
    }),
  })
}
