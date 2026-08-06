# Tài liệu Đặc tả PLAN V1 Specification

## 1. PLAN V1 là gì?

**PLAN V1** là cấu trúc dữ liệu định ước (Contract) chuẩn hóa dưới dạng JSON, được sử dụng để điều phối và quản lý luồng thực thi nhiệm vụ phát triển phần mềm tự động giữa nhiều AI Agent (Codex, Antigravity) trong hệ thống `CHATGPT-LOCAL-ORCHESTRATOR`.

---

## 2. Vai trò của PLAN V1 trong Kiến trúc Hệ thống

Trong mô hình kiến trúc local orchestrator, PLAN V1 đóng vai trò là "Bản thiết kế thực thi" (Execution Plan):

1. **ChatGPT Web (Planner / Orchestrator)**: Khởi tạo mục tiêu (Objective) và phân rã thành các tác vụ (Tasks) cho từng agent phù hợp.
2. **Extension (UI / Transport Layer)**: Tiếp nhận PLAN từ giao diện web, kiểm tra tính hợp lệ sơ bộ và chuyển tiếp tới Local Bridge Service.
3. **Local Bridge Service (Execution Engine)**: Kiểm tra validation toàn diện (Schema & Semantic), phân bổ công việc cho Codex và Antigravity, áp dụng các ranh giới bảo mật (Allowed Paths, Command Safety, Timeouts).

```
+-------------------+       +-----------------------+       +----------------------+
|  ChatGPT Web      | ----> | Chrome Extension UI   | ----> | Local Bridge Service |
| (Plan Generation) |       | (Transport & Status)  |       | (Validation & Exec)  |
+-------------------+       +-----------------------+       +----------------------+
                                                                |         |
                                                                v         v
                                                           [Codex]   [Antigravity]
```

---

## 3. Cấu trúc tổng thể của PLAN V1

Cấu trúc một đối tượng `PlanV1` gồm các trường bắt buộc và tùy chọn được quy định bởi Zod Schema (`PlanV1Schema`):

```json
{
  "schemaVersion": "1.0",
  "planId": "PLAN-20260806-001",
  "projectId": "chatgpt-local-orchestrator",
  "objective": "Triển khai các schema PLAN v1 và công cụ validation cho dự án local orchestrator",
  "baseBranch": "main",
  "tasks": [...],
  "acceptanceCriteria": [...],
  "testCommands": [...],
  "screenshotsRequired": [...],
  "limits": {...}
}
```

---

## 4. Giải thích Chi tiết các Trường (Field Specifications)

| Trường | Kiểu dữ liệu | Ràng buộc / Định dạng | Mô tả |
| :--- | :--- | :--- | :--- |
| `schemaVersion` | String | Cố định `"1.0"` | Phiên bản của PLAN contract |
| `planId` | String | Bắt đầu với `PLAN-`, ký tự `[A-Za-z0-9._-]`, dài 1-120 | Định danh duy nhất cho PLAN |
| `projectId` | String | Ký tự `[A-Za-z0-9._-]`, dài 1-100 | Định danh dự án target |
| `objective` | String | Trimmed, dài 10-2000 ký tự | Mục tiêu tổng thể của bản PLAN |
| `baseBranch` | String | 1-200 ký tự, không chứa khoảng trắng, `..`, `~`, `^`, `:`, `?`, `*`, `[`, `\`` | Nhánh Git gốc để phân nhánh thực thi |
| `tasks` | Array<AgentTask> | Tối thiểu 1 task, tối đa 50 tasks | Danh sách các tác vụ cần thực hiện |
| `acceptanceCriteria` | Array<String> | Tối thiểu 1, tối đa 50 tiêu chí, mỗi tiêu chí 1-1000 ký tự | Tiêu chuẩn nghiệm thu của kế hoạch |
| `testCommands` | Array<String> | Tối đa 30 câu lệnh, mặc định `[]` | Các câu lệnh kiểm thử tự động sau khi làm xong |
| `screenshotsRequired` | Array<Screenshot> | Tối đa 20 yêu cầu screenshot, mặc định `[]` | Yêu cầu chụp ảnh màn hình bằng chứng |
| `limits` | Object (JobLimits) | Theo schema `JobLimitsSchema` | Cấu hình giới hạn tài nguyên và thời gian |

---

### 4.1. Cấu trúc `AgentTask`

Mỗi tác vụ trong mảng `tasks` quy định cụ thể công việc cho một agent:

- **`taskId`** (`string`): Định danh task (ví dụ: `TASK-CODEX-001`), không trùng lặp trong cùng một PLAN.
- **`agent`** (`"codex" | "antigravity"`): Loại agent đảm nhận công việc.
- **`title`** (`string`): Tiêu đề ngắn gọn của task (3-200 ký tự).
- **`instructions`** (`string`): Hướng dẫn chi tiết cho agent (10-10000 ký tự).
- **`allowedPaths`** (`string[]`): Danh sách phạm vi đường dẫn file agent **ĐƯỢC PHÉP** chỉnh sửa (1-50 item).
- **`forbiddenPaths`** (`string[]`): Danh sách phạm vi đường dẫn file agent **CẤM** chỉnh sửa (0-50 item, mặc định `[]`).
- **`dependsOn`** (`string[]`): Danh sách `taskId` mà task này phụ thuộc vào (0-20 item, mặc định `[]`).

---

### 4.2. Cấu trúc `ScreenshotRequirement`

- **`screenshotId`** (`string`): ID của ảnh chụp màn hình (1-100 ký tự).
- **`description`** (`string`): Mô tả giao diện hoặc trạng thái cần chụp (3-1000 ký tự).
- **`required`** (`boolean`): Bắt buộc chụp hay không (mặc định `true`).

---

### 4.3. Cấu trúc `JobLimits`

- **`maxFixRounds`** (`number`): Số lần sửa lỗi tối đa khi test fail (0-2 round, mặc định `2`).
- **`agentTimeoutMinutes`** (`number`): Thời gian chạy tối đa cho mỗi agent (1-180 phút, mặc định `45`).
- **`jobTimeoutMinutes`** (`number`): Thời gian tổng cho toàn bộ job (1-480 phút, mặc định `120`).
- **`maxChangedFilesPerAgent`** (`number`): Số lượng file tối đa một agent được sửa (1-100 file, mặc định `30`).
- **`maxCommandsPerAgent`** (`number`): Số lệnh tối đa một agent được thực thi (1-200 lệnh, mặc định `80`).

---

## 5. Ví dụ PLAN V1 Hợp lệ (Valid Plan Example)

```json
{
  "schemaVersion": "1.0",
  "planId": "PLAN-20260806-001",
  "projectId": "chatgpt-local-orchestrator",
  "objective": "Triển khai các schema PLAN v1 và công cụ validation cho dự án local orchestrator",
  "baseBranch": "main",
  "tasks": [
    {
      "taskId": "TASK-CODEX-001",
      "agent": "codex",
      "title": "Triển khai contracts và validation backend",
      "instructions": "Tạo các Zod schema và logic validate plan trong packages/contracts.",
      "allowedPaths": [
        "packages/contracts/**"
      ],
      "forbiddenPaths": [
        "apps/extension/**"
      ],
      "dependsOn": []
    },
    {
      "taskId": "TASK-ANTIGRAVITY-001",
      "agent": "antigravity",
      "title": "Tạo PLAN mẫu và tài liệu hướng dẫn",
      "instructions": "Tạo bộ PLAN mẫu, script kiểm tra mẫu và viết tài liệu hướng dẫn trong docs.",
      "allowedPaths": [
        "examples/phase-1/**",
        "scripts/phase-1/**",
        "docs/plan-v1.md",
        "docs/plan-validation.md"
      ],
      "forbiddenPaths": [
        "apps/bridge/**"
      ],
      "dependsOn": [
        "TASK-CODEX-001"
      ]
    }
  ],
  "acceptanceCriteria": [
    "PLAN v1 schema được validate đúng cấu trúc.",
    "Tất cả sample invalid bị từ chối với lý do tương ứng."
  ],
  "testCommands": [
    "pnpm --filter @local-orchestrator/contracts test",
    "node scripts/phase-1/validate-plan-samples.mjs"
  ],
  "screenshotsRequired": [
    {
      "screenshotId": "SHOT-VALIDATION-SUCCESS",
      "description": "Màn hình console khi chạy script validate-plan-samples.mjs thành công.",
      "required": true
    }
  ],
  "limits": {
    "maxFixRounds": 2,
    "agentTimeoutMinutes": 45,
    "jobTimeoutMinutes": 120,
    "maxChangedFilesPerAgent": 30,
    "maxCommandsPerAgent": 80
  }
}
```

---

## 6. Quy tắc Phân định Scope và Ranh giới An toàn (Path Scope Rules)

### 6.1. Quy tắc không sửa chung file (No Cross-Agent File Overlap)
- Hai agent khác nhau (`codex` và `antigravity`) **KHÔNG ĐƯỢC PHÉP** có `allowedPaths` giao nhau hoặc đè lên nhau.
- Nếu xảy ra hiện tượng overlap giữa `allowedPaths` của hai agent khác nhau, validator sẽ báo lỗi `CROSS_AGENT_PATH_CONFLICT`.

### 6.2. Cú pháp Đường dẫn Hợp lệ (Exact Path & Subtree Wildcard)
Hệ thống Phase 1 quy định định dạng `allowedPaths` và `forbiddenPaths` như sau:
1. **Exact Path**: Đường dẫn chính xác tới 1 file hoặc thư mục cụ thể không chứa wildcard. (Ví dụ: `docs/plan-v1.md`, `packages/contracts/package.json`).
2. **Subtree Wildcard**: Đường dẫn thư mục kết thúc bằng `/**`. (Ví dụ: `apps/bridge/**`, `packages/contracts/**`).

---

## 7. Các Giới hạn Hiện tại của Path Scope trong Phase 1

> [!IMPORTANT]
> **Phase 1 CHỈ HỖ TRỢ**:
> - Exact path (ví dụ `docs/plan-v1.md`)
> - Subtree wildcard kết thúc chính xác bằng `/**` (ví dụ `apps/bridge/**`)

> [!CAUTION]
> **Phase 1 KHÔNG HỖ TRỢ các định dạng sau**:
> - Glob tập tin: `src/*.ts`
> - Glob giữa đường dẫn: `src/**/test.ts`
> - Double star đứng một mình: `**`
> - Đường dẫn tuyệt đối (Absolute paths): `/src/**`, `C:\Project\src`
> - Dấu xược ngược Windows (Backslash): `apps\bridge\index.ts`
