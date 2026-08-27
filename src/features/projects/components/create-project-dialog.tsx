import { useEffect, useRef, useState } from "react";
import { FolderPlus } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { mockMembers } from "@/features/projects/mock-data";
import type {
  CreateMockProjectInput,
  MemberSummary,
  ProjectPriority,
} from "@/features/projects/types";

type CreateProjectDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateMockProjectInput, idempotencyKey: string) => void | Promise<void>;
  members?: readonly MemberSummary[];
  allowMemberSelection?: boolean;
};

type ProjectFormErrors = Partial<Record<"name" | "description" | "startDate" | "dueDate", string>>;

const priorityOptions: Array<{ value: ProjectPriority; label: string }> = [
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "critical", label: "紧急" },
  { value: "low", label: "低" },
];

function initials(name: string) {
  return name.slice(-2);
}

export function CreateProjectDialog({ open, onClose, onCreate, members = mockMembers, allowMemberSelection = true }: CreateProjectDialogProps) {
  const defaultOwnerId = members[0]?.id ?? "";
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [memberIds, setMemberIds] = useState<string[]>(defaultOwnerId ? [defaultOwnerId] : []);
  const [priority, setPriority] = useState<ProjectPriority>("high");
  const [status, setStatus] = useState<CreateMockProjectInput["status"]>("planning");
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      if (document.activeElement instanceof HTMLElement) restoreFocusRef.current = document.activeElement;
      setErrors({});
      setMessage("");
      setOwnerId(defaultOwnerId);
      setMemberIds(defaultOwnerId ? [defaultOwnerId] : []);
      attemptRef.current = null;
    }
    wasOpenRef.current = open;
  }, [defaultOwnerId, open]);

  function closeDialog(force = false) {
    if (isSubmitting && !force) return;
    const restoreTarget = restoreFocusRef.current;
    onClose();
    queueMicrotask(() => restoreTarget?.focus());
  }

  function changeOwner(nextOwnerId: string) {
    setOwnerId(nextOwnerId);
    setMemberIds((current) => [...new Set([nextOwnerId, ...current])]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const startDate = String(formData.get("startDate") ?? "");
    const dueDate = String(formData.get("dueDate") ?? "");
    const category = String(formData.get("category") ?? "企业项目").trim();
    const budgetAmount = String(formData.get("budgetAmount") ?? "0").trim();
    const nextErrors: ProjectFormErrors = {
      ...(!name ? { name: "请输入项目名称" } : {}),
      ...(!description ? { description: "请输入项目描述" } : {}),
      ...(!startDate ? { startDate: "请选择开始日期" } : {}),
      ...(!dueDate ? { dueDate: "请选择截止日期" } : {}),
      ...(startDate && dueDate && dueDate < startDate
        ? { dueDate: "截止日期不能早于开始日期" }
        : {}),
    };

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setMessage(Object.values(nextErrors)[0] ?? "请检查项目信息");
      return;
    }

    const input = {
        name,
        description,
        category,
        budgetAmount,
        ownerId,
        memberIds,
        startDate,
        dueDate,
        priority,
        status,
      } satisfies CreateMockProjectInput;
    const signature = JSON.stringify(input);
    if (attemptRef.current?.signature !== signature) {
      attemptRef.current = { signature, key: crypto.randomUUID() };
    }

    try {
      setIsSubmitting(true);
      await onCreate(input, attemptRef.current.key);
      attemptRef.current = null;
      closeDialog(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "项目创建失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isSubmitting && closeDialog()}>
      <DialogContent className="h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-start gap-3 pr-10">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <FolderPlus aria-hidden="true" className="size-5" />
          </span>
          <DialogHeader>
            <DialogTitle className="text-lg">新建项目</DialogTitle>
            <DialogDescription className="text-xs leading-5">
              建立项目目标、负责人和交付周期，创建后可继续拆解任务。
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="mt-1 grid gap-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <label className="grid gap-1.5 text-sm font-medium text-foreground">项目分类<Input name="category" defaultValue="企业项目" maxLength={80} className="h-10 rounded-xl bg-white/75" /></label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">预算（元）<Input name="budgetAmount" inputMode="decimal" defaultValue="0.00" pattern="[0-9]+([.][0-9]{1,2})?" className="h-10 rounded-xl bg-white/75" /></label>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="project-name" className="text-sm font-medium text-foreground">项目名称</label>
            <Input
              id="project-name"
              name="name"
              autoFocus
              aria-invalid={Boolean(errors.name)}
              placeholder="例如：客户门户二期"
              className="h-10 rounded-xl bg-white/75"
            />
            {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="project-description" className="text-sm font-medium text-foreground">项目描述</label>
            <Textarea
              id="project-description"
              name="description"
              aria-invalid={Boolean(errors.description)}
              placeholder="说明项目目标、范围和预期交付结果"
              className="min-h-22 rounded-xl bg-white/75"
            />
            {errors.description ? <p className="text-xs text-destructive">{errors.description}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="project-owner" className="text-sm font-medium text-foreground">项目负责人</label>
              <Select value={ownerId} onValueChange={changeOwner}>
                <SelectTrigger id="project-owner" className="h-10 w-full bg-white/75" aria-label="项目负责人">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>{member.displayName} · {member.title}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="project-priority" className="text-sm font-medium text-foreground">优先级</label>
              <Select value={priority} onValueChange={(value) => setPriority(value as ProjectPriority)}>
                <SelectTrigger id="project-priority" className="h-10 w-full bg-white/75" aria-label="优先级">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {priorityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {allowMemberSelection ? <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-foreground">项目成员</legend>
            <ToggleGroup
              type="multiple"
              value={memberIds}
              onValueChange={(values) => setMemberIds([...new Set([ownerId, ...values])])}
              className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {members.map((member) => (
                <ToggleGroupItem
                  key={member.id}
                  value={member.id}
                  aria-label={`选择成员${member.displayName}`}
                  className="h-auto justify-start gap-2 rounded-xl border border-glass-border bg-white/55 px-2.5 py-2 data-[state=on]:border-primary/35 data-[state=on]:bg-primary/8"
                >
                  <Avatar size="sm">
                    <AvatarFallback className="bg-brand-soft text-[10px] font-semibold text-primary">
                      {initials(member.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-xs font-semibold">{member.displayName}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{member.department}</span>
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </fieldset> : <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">项目创建后，可在项目成员管理中继续配置参与人。</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="project-start" className="text-sm font-medium text-foreground">开始日期</label>
              <Input id="project-start" name="startDate" type="date" aria-invalid={Boolean(errors.startDate)} className="h-10 rounded-xl bg-white/75" />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="project-due" className="text-sm font-medium text-foreground">截止日期</label>
              <Input id="project-due" name="dueDate" type="date" aria-invalid={Boolean(errors.dueDate)} className="h-10 rounded-xl bg-white/75" />
            </div>
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-foreground">初始状态</legend>
            <ToggleGroup
              type="single"
              value={status}
              onValueChange={(value) => value && setStatus(value as CreateMockProjectInput["status"])}
              className="grid w-full grid-cols-2 gap-2"
            >
              <ToggleGroupItem value="planning" className="rounded-xl border border-glass-border bg-white/55 data-[state=on]:border-primary/35 data-[state=on]:bg-primary/8">
                规划中
              </ToggleGroupItem>
              <ToggleGroupItem value="active" className="rounded-xl border border-glass-border bg-white/55 data-[state=on]:border-primary/35 data-[state=on]:bg-primary/8">
                进行中
              </ToggleGroupItem>
            </ToggleGroup>
          </fieldset>

          {message ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-destructive">{message}</p> : null}

          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => closeDialog()} className="h-9 rounded-xl">取消</Button>
            <Button type="submit" disabled={isSubmitting || !ownerId} className="h-9 rounded-xl px-4">{isSubmitting ? "正在创建…" : "创建项目"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
