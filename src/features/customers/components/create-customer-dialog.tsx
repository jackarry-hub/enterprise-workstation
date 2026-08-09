"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CreateCustomerInput, CustomerIndustry, CustomerSource } from "@/features/customers/customer-types";

const initialValue: CreateCustomerInput = { name: "", contactName: "", phone: "", industry: "technology", source: "consulting" };

export function CreateCustomerDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (input: CreateCustomerInput) => void }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError("");
    }
  }, [open]);

  function submit() {
    if (!value.name.trim() || !value.contactName.trim()) {
      setError("请填写客户名称和联系人");
      return;
    }
    onCreate({ ...value, name: value.name.trim(), contactName: value.contactName.trim() });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-label="新建客户" className="sm:max-w-xl">
        <DialogHeader><DialogTitle>新建客户</DialogTitle><DialogDescription>录入基础客户资料，快速进入后续跟进流程。</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm"><span>客户名称</span><Input aria-label="客户名称" value={value.name} onChange={(event) => setValue((current) => ({ ...current, name: event.target.value }))} autoFocus /></label>
          <label className="space-y-1.5 text-sm"><span>联系人</span><Input aria-label="联系人" value={value.contactName} onChange={(event) => setValue((current) => ({ ...current, contactName: event.target.value }))} /></label>
          <label className="space-y-1.5 text-sm"><span>联系电话</span><Input aria-label="联系电话" value={value.phone} onChange={(event) => setValue((current) => ({ ...current, phone: event.target.value }))} /></label>
          <label className="space-y-1.5 text-sm"><span>所属行业</span><Select value={value.industry} onValueChange={(industry) => setValue((current) => ({ ...current, industry: industry as CustomerIndustry }))}><SelectTrigger aria-label="所属行业" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="technology">信息技术</SelectItem><SelectItem value="manufacturing">制造业</SelectItem><SelectItem value="finance">金融服务</SelectItem><SelectItem value="retail">零售消费</SelectItem></SelectContent></Select></label>
          <label className="space-y-1.5 text-sm sm:col-span-2"><span>客户来源</span><Select value={value.source} onValueChange={(source) => setValue((current) => ({ ...current, source: source as CustomerSource }))}><SelectTrigger aria-label="客户来源" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="consulting">官网咨询</SelectItem><SelectItem value="referral">客户推荐</SelectItem><SelectItem value="event">市场活动</SelectItem><SelectItem value="outbound">行业展会</SelectItem></SelectContent></Select></label>
        </div>
        {error ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="button" onClick={submit}>保存客户</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
