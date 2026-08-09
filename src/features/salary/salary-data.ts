import { salaryMockResult } from "@/features/salary/salary-mock-data";

export async function loadSalary() {
  return salaryMockResult;
}

export async function loadSalaryDetail(publicId: string) {
  return salaryMockResult.data.records.find((record) => record.id === publicId);
}
