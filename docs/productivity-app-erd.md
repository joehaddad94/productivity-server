# Productivity App – Corrected ERD

Single **Daily_Stats** table, **Notes.task_id** (link to task), and unique `(workspace_id, user_id, date)` for daily stats.

## Entity-Relationship Diagram

```mermaid
erDiagram
    Users ||--o{ Verification_Tokens : "has"
    Users ||--o{ Sessions : "has"
    Users ||--o{ Workspace_Members : "is"
    Users ||--o{ Daily_Stats : "has"
    Users ||--o{ Notes : "assigned"

    Workspaces ||--o{ Workspace_Members : "has"
    Workspaces ||--o{ Projects : "contains"
    Workspaces ||--o{ Tasks : "contains"
    Workspaces ||--o{ Notes : "contains"
    Workspaces ||--o{ Daily_Stats : "scoped to"

    Projects ||--o{ Notes : "contains"
    Tasks ||--o{ Notes : "linked by"
    Tasks ||--o{ Tasks : "subtask of"

    Users {
        uuid id PK
        string email
        string name
        string avatar_url
        string timezone
        timestamp updated_at
    }

    Verification_Tokens {
        uuid id PK
        string email
        string token UK
        timestamp expires_at
    }

    Sessions {
        uuid id PK
        uuid user_id FK
        string token UK
        timestamp expires_at
        timestamp created_at
    }

    Workspaces {
        uuid id PK
        string name
        string slug UK
        boolean is_personal
        timestamp created_at
    }

    Workspace_Members {
        uuid id PK
        uuid user_id FK
        uuid workspace_id FK
        string role "member"
    }

    Projects {
        uuid id PK
        uuid workspace_id FK
        string name
        timestamp created_at
    }

    Tasks {
        uuid id PK
        uuid workspace_id FK
        string title
        string description
        date due_date
        string priority
        string status "pending"
        timestamp completed_at
        uuid parent_task_id FK
        timestamp created_at
        timestamp deleted_at
    }

    Notes {
        uuid id PK
        uuid workspace_id FK
        uuid project_id FK
        uuid assignee_id FK
        uuid task_id FK
        string title
        string description
        string status
        timestamp completed_at
        timestamp created_at
        timestamp updated_at
    }

    Daily_Stats {
        uuid id PK
        uuid workspace_id FK
        uuid user_id FK
        date date
        int tasks_completed
        int focus_minutes
        timestamp created_at
    }
```

## Corrections applied

| Item | Change |
|------|--------|
| **Daily_Stats** | Single table; one row per (workspace, user, date). Unique on `(workspace_id, user_id, date)`. |
| **Notes → Task** | `parent_task_id` renamed to `task_id` (note linked to one task). |
| **Diagram** | No duplicate entities; relationships match FKs above. |

## Unique / constraints

- **Verification_Tokens**: `token` unique  
- **Sessions**: `token` unique  
- **Workspaces**: `slug` unique  
- **Daily_Stats**: unique `(workspace_id, user_id, date)`

Render this in [Mermaid Live](https://mermaid.live), VS Code (Mermaid extension), or open `productivity-app-erd.html` and use **Print → Save as PDF**.
