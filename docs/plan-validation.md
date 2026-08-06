# Tài liệu Hướng dẫn Validation PLAN V1

## 1. Tổng quan về Validation Engine

Validation Engine cho PLAN V1 nằm trong gói `@local-orchestrator/contracts` và được xuất bản qua hàm `validatePlan(input: unknown)`.

Hàm `validatePlan` tiếp nhận một dữ liệu chưa biết (`unknown`) và thực hiện quy trình kiểm tra 2 bước:
1. **Structural Validation (Schema Check)**: Dùng Zod (`PlanV1Schema`) kiểm tra kiên quyết kiểu dữ liệu, các trường bắt buộc, giá trị biên, chuỗi chuẩn hóa và cấm các thuộc tính không khai báo (`.strict()`).
2. **Semantic Validation (Logic Check)**: Kiểm tra logic nghiệp vụ giữa các task, ranh giới file, đồ thị phụ thuộc, độ an toàn của câu lệnh và mối quan hệ giới hạn thời gian execution.

---

## 2. Cách Gọi và Kết Quả Trả Về

### 2.1. Cách gọi trong Node.js / TypeScript

```typescript
import { validatePlan } from "@local-orchestrator/contracts";

const planData = JSON.parse(fs.readFileSync("plan.json", "utf-8"));
const result = validatePlan(planData);

if (result.success) {
  console.log("PLAN hợp lệ!", result.data);
} else {
  console.error("PLAN không hợp lệ! Danh sách lỗi:", result.issues);
}
```

---

### 2.2. Cấu trúc Kết quả Trả về (`PlanValidationResult`)

`PlanValidationResult` là một discriminated union:

#### Kết quả Thành công (`success: true`):
```typescript
{
  success: true,
  data: PlanV1 // Đối tượng PlanV1 đã được parse và default hóa
}
```

#### Kết quả Thất bại (`success: false`):
```typescript
{
  success: false,
  issues: PlanValidationIssue[]
}
```

---

## 3. Cấu trúc Đối tượng Lỗi (`PlanValidationIssue`)

Mỗi lỗi trong mảng `issues` có cấu trúc:

```typescript
export interface PlanValidationIssue {
  code: PlanValidationIssueCode; // Mã lỗi chuẩn hóa
  path: string;                  // Đường dẫn truy cập tới thuộc tính bị lỗi (VD: "tasks.0.allowedPaths.1")
  message: string;               // Mô tả chi tiết bằng ngôn ngữ tự nhiên
  details?: Record<string, unknown>; // Chi tiết phụ bổ sung context (VD: { cycle: ["TASK-001", "TASK-002", "TASK-001"] })
}
```

---

## 4. Danh sách Toàn bộ Mã Lỗi (`PlanValidationIssueCode`)

| Mã Issue Code | Nguồn kiểm tra | Nguyên nhân kích hoạt |
| :--- | :--- | :--- |
| `SCHEMA_INVALID` | Zod Schema | Cấu trúc JSON sai kiểu dữ liệu, thiếu trường bắt buộc, vượt giới hạn độ dài hoặc chứa thuộc tính không hợp lệ |
| `DUPLICATE_TASK_ID` | Semantic | Có từ 2 task trở lên dùng chung một `taskId` |
| `SELF_DEPENDENCY` | Semantic | Một task khai báo phụ thuộc vào chính nó (`dependsOn` chứa `taskId` của bản thân) |
| `UNKNOWN_DEPENDENCY` | Semantic | Task phụ thuộc vào một `taskId` không tồn tại trong danh sách `tasks` |
| `CYCLIC_DEPENDENCY` | Semantic | Đồ thị phụ thuộc chứa chu kỳ khép kín (ví dụ A -> B -> A hoặc A -> B -> C -> A) |
| `INVALID_PATH_SCOPE` | Semantic | Chuỗi path scope sai cú pháp (chứa backslash `\`, chứa `..`, bắt đầu bằng `/`, hoặc chứa wildcard không hợp lệ) |
| `DUPLICATE_PATH_SCOPE` | Semantic | Chuỗi path scope bị lặp lại chính xác trong danh sách `allowedPaths` hoặc `forbiddenPaths` |
| `TASK_SCOPE_CONTRADICTION` | Semantic | Trong cùng một task, `allowedPaths` và `forbiddenPaths` bị giao / đè lên nhau |
| `CROSS_AGENT_PATH_CONFLICT` | Semantic | Hai task thuộc 2 agent khác nhau có `allowedPaths` giao hoặc đè lên nhau |
| `UNSAFE_TEST_COMMAND` | Semantic | Câu lệnh trong `testCommands` chứa ký tự nối lệnh (`&&`, `;`, `|`), ghi đè file (`>`), hoặc chứa lệnh rủi ro (`rm -rf`, `curl`, `powershell`, ...) |
| `DUPLICATE_ACCEPTANCE_CRITERION` | Semantic | Danh sách `acceptanceCriteria` có hai tiêu chí giống hệt nhau (không phân biệt hoa/thường sau khi trim) |
| `INVALID_LIMIT_RELATIONSHIP` | Semantic | Cấu hình `limits.jobTimeoutMinutes` nhỏ hơn `limits.agentTimeoutMinutes` |

---

## 5. Phân tích Chi tiết Logic Kiểm tra Semantic

### 5.1. Kiểm tra Xung đột Đường dẫn (Path Conflict Detection)
- Hàm `isValidPathScope(scope)` xác minh chuỗi đường dẫn tương đối.
- Các đường dẫn được chuẩn hóa bằng `normalizePathScope(scope)` (chuyển `path/**` về dạng chuẩn).
- Hàm `pathScopesOverlap(left, right)` kiểm tra 2 path scope có đè lên nhau hay không:
  - Exact vs Exact: `"src/a.ts"` và `"src/a.ts"` -> OVERLAP.
  - Subtree vs Subtree: `"src/**"` và `"src/sub/**"` -> OVERLAP.
  - Exact vs Subtree: `"src/sub/a.ts"` và `"src/**"` -> OVERLAP.

### 5.2. Kiểm tra Đồ thị Phụ thuộc (Dependency Graph Analysis)
- Thuật toán duyệt đồ thị dạng DFS (Depth-First Search) phát hiện chu kỳ khép kín (`cycles`).
- Phát hiện các phụ thuộc không tồn tại (`unknown`) hoặc tự phụ thuộc (`self`).

### 5.3. Kiểm tra An toàn Câu lệnh (Command Safety Check)
- Lệnh bị từ chối nếu chứa: `&&`, `||`, `;`, `|`, `>`, `<`, `` ` ``, `$(`.
- Lệnh bị từ chối nếu chứa các từ khóa nguy hiểm: `rm -rf`, `del /s`, `format`, `shutdown`, `git push`, `git reset --hard`, `curl`, `wget`, `powershell -command`, `cmd /c`, `bash -c`.

### 5.4. Kiểm tra Mối quan hệ Thời gian (Limit Relationship Check)
- Đảm bảo thời gian chạy tổng của Job không nhỏ hơn thời gian chạy của 1 agent đơn lẻ (`jobTimeoutMinutes >= agentTimeoutMinutes`).

---

## 6. Ví dụ Đọc Lỗi Chi tiết từ Script / Log

Ví dụ khi validate một PLAN chứa lệnh nguy hiểm và phụ thuộc vòng:

```json
{
  "success": false,
  "issues": [
    {
      "code": "CYCLIC_DEPENDENCY",
      "path": "tasks",
      "message": "Dependency cycle detected",
      "details": {
        "cycle": ["TASK-001", "TASK-002", "TASK-001"]
      }
    },
    {
      "code": "UNSAFE_TEST_COMMAND",
      "path": "testCommands.0",
      "message": "Unsafe test command"
    }
  ]
}
```

---

## 7. Các Hạn chế Hiện tại của Validator trong Phase 1

1. **Không truy cập File System thực tế**: Validator chỉ kiểm tra cú pháp và logic trên đối tượng JSON truyền vào, chưa đối chiếu xem tập tin hoặc thư mục đó có thực sự tồn tại trên ổ đĩa hay không.
2. **Path Scope đơn giản**: Chỉ nhận diện exact file path hoặc subtree `/**`. Chưa hỗ trợ regex hay mảng glob phức tạp.
3. **Danh sách lệnh cấm cố định**: Danh sách lệnh bị cấm được hardcode trong package contracts, chưa nạp quy tắc cho phép/cấm động từ file cấu hình dự án.
