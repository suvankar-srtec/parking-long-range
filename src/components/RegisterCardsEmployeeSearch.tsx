"use client";

import { useMemo, useState } from "react";
import RegisterEmployeeCard from "@/components/RegisterEmployeeCard";

type Employee = {
  id: string;
  name: string;
  userId: string;
  category: string;
  department: string;
  parkingLimit: number;
  vehicles: { id: string; plateNumber: string; rfidCardNo: string | null; isInside: boolean }[];
};

export default function RegisterCardsEmployeeSearch({
  companyId,
  buildingId,
  employees,
  departments,
  maximumDepartments,
  disabled,
}: {
  companyId: string;
  buildingId: string;
  employees: Employee[];
  departments: { id: string; name: string }[];
  maximumDepartments: number;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return employees;
    return employees.filter((employee) => {
      const vehicleMatch = employee.vehicles.some((vehicle) =>
        [vehicle.plateNumber, vehicle.rfidCardNo || ""].some((value) => value.toLowerCase().includes(search))
      );
      return vehicleMatch || [
        employee.name,
        employee.userId,
        employee.department,
        employee.category === "OWNER" ? "company owner" : "employee",
      ].some((value) => value.toLowerCase().includes(search));
    });
  }, [employees, query]);

  return <>
    <div className="rfid-employee-search">
      <div className="rfid-employee-search-field">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, User ID, department, vehicle or RFID"
          aria-label="Search employees and RFID cards"
        />
      </div>
    </div>

    {filtered.length ? <div className="rfid-employee-table-wrap">
      <table className="rfid-employee-table">
        <thead><tr><th>Employee</th><th>Vehicle</th><th>RFID card number</th><th>Registration</th></tr></thead>
        <tbody>{filtered.flatMap((employee) => {
          const vehicles = employee.vehicles.length ? employee.vehicles : [null];
          return vehicles.map((vehicle, index) => <tr key={vehicle?.id || employee.id}>
            {index === 0 && <th rowSpan={vehicles.length} className="rfid-employee-person">
              <strong>{employee.name}</strong>
              <span>{employee.userId} · {employee.category === "OWNER" ? "Company owner" : "Employee"}</span>
              <span>{employee.department}</span>
            </th>}
            <td>{vehicle?.plateNumber || <span className="rfid-muted">No vehicle added</span>}</td>
            <td>{vehicle?.rfidCardNo ? <code className="rfid-card-number">{vehicle.rfidCardNo}</code> : <span className="rfid-missing">Not registered</span>}</td>
            <td>{vehicle?.rfidCardNo
              ? <span className="rfid-registered">Registered</span>
              : <RegisterEmployeeCard
                  companyId={companyId}
                  buildingId={buildingId}
                  employee={employee}
                  vehicle={vehicle || undefined}
                  departments={departments}
                  maximumDepartments={maximumDepartments}
                  disabled={disabled}
                />}</td>
          </tr>);
        })}</tbody>
      </table>
    </div> : <div className="rfid-employee-empty">No employees, vehicles, or RFID cards match “{query}”.</div>}
  </>;
}
