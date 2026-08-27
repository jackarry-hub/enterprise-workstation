"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CreateCustomerInput, CustomerSource } from "@/features/customers/customer-types";
import type { MemberSummary } from "@/features/projects/types";

const initialValue: CreateCustomerInput = {
  name: "", registrationCode: "", contactName: "", contactTitle: "",
  phone: "", email: "", industry: "", source: "consulting", region: "",
  ownerEmployeePublicId: "",
};

type CreateResult = { ok: true } | { ok: false; message: string; customerCreated?: boolean };

export function CreateCustomerDialog({
  open,
  onOpenChange,
  owners,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owners: readonly MemberSummary[];
  onCreate: (input: CreateCustomerInput) => Promise<CreateResult>;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [customerCreated, setCustomerCreated] = useState(false);

  useEffect(() => {
    if (open) {
      setValue({ ...initialValue, ownerEmployeePublicId: owners[0]?.employeePublicId ?? "" });
      setError("");
      setSubmitting(false);
      setCustomerCreated(false);
    }
  }, [open, owners]);

  async function submit() {
    if (!value.name.trim() || !value.contactName.trim() || !value.industry.trim()
      || !value.ownerEmployeePublicId || (!value.phone.trim() && !value.email.trim())) {
      setError("请完整填写客户、行业、负责人、联系人，以及电话或邮箱。");
      return;
    }
    setSubmitting(true);
    setError("");
    const result = await onCreate({
      ...value,
      name: value.name.trim(), registrationCode: value.registrationCode.trim(),
      contactName: value.contactName.trim(), contactTitle: value.contactTitle.trim(),
      phone: value.phone.trim(), email: value.email.trim(), industry: value.industry.trim(), region: value.region.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      if (result.customerCreated) setCustomerCreated(true);
      setError(result.customerCreated ? `客户档案已创建，但主联系人保存失败：${result.message}` : result.message);
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent aria-label="新建客户" className="max-h-[100dvh] overflow-y-auto max-sm:top-0 max-sm:left-0 max-sm:h-[100dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-2xl">
        <DialogHeader><DialogTitle>新建客户</DialogTitle><DialogDescription>客户档案与主联系人将通过审计命令写入当前组织，保存成功后才会出现在列表。</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm sm:col-span-2"><span>客户名称 *</span><Input aria-label="客户名称" disabled={customerCreated} maxLength={160} value={value.name} onChange={(event) => setValue((current) => ({ ...current, name: event.target.value }))} autoFocus /></label>
          <label className="space-y-1.5 text-sm"><span>统一登记号</span><Input aria-label="统一登记号" disabled={customerCreated} maxLength={80} value={value.registrationCode} onChange={(event) => setValue((current) => ({ ...current, registrationCode: event.target.value }))} /></label>
          <label className="space-y-1.5 text-sm"><span>所属行业 *</span><Input aria-label="所属行业" disabled={customerCreated} maxLength={80} placeholder="如：企业服务" value={value.industry} onChange={(event) => setValue((current) => ({ ...current, industry: event.target.value }))} /></label>
          <label className="space-y-1.5 text-sm"><span>地区</span><Input aria-label="客户地区" disabled={customerCreated} maxLength={120} placeholder="如：上海" value={value.region} onChange={(event) => setValue((current) => ({ ...current, region: event.target.value }))} /></label>
          <label className="space-y-1.5 text-sm"><span>客户来源</span><Select disabled={customerCreated} value={value.source} onValueChange={(source) => setValue((current) => ({ ...current, source: source as CustomerSource }))}><SelectTrigger aria-label="客户来源" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="consulting">官网咨询</SelectItem><SelectItem value="referral">客户推荐</SelectItem><SelectItem value="event">市场活动</SelectItem><SelectItem value="outbound">主动拓展</SelectItem><SelectItem value="other">其他</SelectItem></SelectContent></Select></label>
          <label className="space-y-1.5 text-sm sm:col-span-2"><span>负责人 *</span><Select disabled={customerCreated} value={value.ownerEmployeePublicId} onValueChange={(ownerEmployeePublicId) => setValue((current) => ({ ...current, ownerEmployeePublicId }))}><SelectTrigger aria-label="客户负责人" className="w-full"><SelectValue placeholder="选择负责人" /></SelectTrigger><SelectContent>{owners.map((owner) => owner.employeePublicId ? <SelectItem key={owner.employeePublicId} value={owner.employeePublicId}>{owner.displayName} · {owner.department}</SelectItem> : null)}</SelectContent></Select></label>
          <div className="sm:col-span-2"><p className="border-t border-border pt-3 text-sm font-semibold">主联系人</p></div>
          <label className="space-y-1.5 text-sm"><span>联系人 *</span><Input aria-label="联系人" maxLength={120} value={value.contactName} onChange={(event) => setValue((current) => ({ ...current, contactName: event.target.value }))} /></label>
          <label className="space-y-1.5 text-sm"><span>职务</span><Input aria-label="联系人职务" maxLength={120} value={value.contactTitle} onChange={(event) => setValue((current) => ({ ...current, contactTitle: event.target.value }))} /></label>
          <label className="space-y-1.5 text-sm"><span>联系电话</span><Input aria-label="联系电话" type="tel" maxLength={80} value={value.phone} onChange={(event) => setValue((current) => ({ ...current, phone: event.target.value }))} /></label>
          <label className="space-y-1.5 text-sm"><span>联系邮箱</span><Input aria-label="联系邮箱" type="email" maxLength={320} value={value.email} onChange={(event) => setValue((current) => ({ ...current, email: event.target.value }))} /></label>
        </div>
        {customerCreated ? <p role="status" className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">客户基础档案已锁定。请重试保存主联系人；也可以关闭后从客户详情补充。</p> : null}
        {owners.length === 0 ? <p role="alert" className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">当前没有可分配的在职负责人，暂时不能新建客户。</p> : null}
        {error ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="max-sm:sticky max-sm:bottom-0 max-sm:bg-background max-sm:py-3"><Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button><Button type="button" disabled={submitting || owners.length === 0} onClick={submit}>{submitting ? "正在写入…" : "保存客户"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
