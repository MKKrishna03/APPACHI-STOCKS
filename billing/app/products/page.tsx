"use client";

import { useEffect, useRef, useState } from "react";
import CustomSelect from "@/components/CustomSelect";

type Product = {
  id: string;
  name: string;
  category: "Gold" | "Silver";
  product_group: string | null;
  purity: string | null;
  wastage_tier_1: string | null;
  wastage_tier_2: string | null;
  wastage_tier_3: string | null;
};

const emptyForm = {
  name: "",
  category: "Gold" as Product["category"],
  productGroup: "",
  purity: "",
  wastageTier1: "",
  wastageTier2: "",
  wastageTier3: "",
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filterCategory, setFilterCategory] = useState("");
  const [filterGroup, setFilterGroup] = useState("");

  async function loadProducts() {
    const res = await fetch("/billing/api/products");
    const data = await res.json();
    setProducts(data);
    setLoading(false);
  }

  useEffect(() => {
    loadProducts();
  }, []);

  const groups = Array.from(
    new Set(products.map((p) => p.product_group).filter(Boolean))
  ) as string[];

  const filteredProducts = products.filter((p) => {
    if (filterCategory && p.category !== filterCategory) return false;
    if (filterGroup && p.product_group !== filterGroup) return false;
    return true;
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;

    if (editingId) {
      await fetch(`/billing/api/products/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setEditingId(null);
    } else {
      await fetch("/billing/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    }
    setForm(emptyForm);
    setShowForm(false);
    await loadProducts();
  }

  function handleEdit(p: Product) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      category: p.category,
      productGroup: p.product_group ?? "",
      purity: p.purity ?? "",
      wastageTier1: p.wastage_tier_1 ?? "",
      wastageTier2: p.wastage_tier_2 ?? "",
      wastageTier3: p.wastage_tier_3 ?? "",
    });
    setShowForm(true);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  async function handleRemove(id: string) {
    await fetch(`/billing/api/products/${id}`, { method: "DELETE" });
    if (editingId === id) handleCancelEdit();
    await loadProducts();
  }

  function handleDownloadExport() {
    const params = new URLSearchParams();
    if (filterCategory) params.set("category", filterCategory);
    if (filterGroup) params.set("productGroup", filterGroup);
    window.location.href = `/billing/api/products/export?${params.toString()}`;
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/billing/api/products/bulk-upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setUploadResult(
        `Added ${data.inserted} product(s).` +
          (data.errors?.length ? ` ${data.errors.length} row(s) skipped.` : "")
      );
      await loadProducts();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
      <div>
        <h1 className="heading text-2xl font-semibold">Products</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Add gold and silver products here. Wastage percentages can be left
          blank for now and uploaded later.
        </p>
      </div>

      <div className="card flex flex-wrap gap-3 items-end p-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Ornament Type</label>
          <CustomSelect
            value={filterCategory}
            onChange={setFilterCategory}
            options={[
              { value: "", label: "All" },
              { value: "Gold", label: "Gold" },
              { value: "Silver", label: "Silver" },
            ]}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Product Group</label>
          <CustomSelect
            value={filterGroup}
            onChange={setFilterGroup}
            options={[
              { value: "", label: "All" },
              ...groups.map((g) => ({ value: g, label: g })),
            ]}
          />
        </div>

        <div className="flex gap-2 ml-auto flex-wrap">
          <a href="/billing/api/products/template" className="btn-secondary">
            Sample Template
          </a>
          <button onClick={handleDownloadExport} className="btn-secondary">
            Excel Download
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-secondary"
          >
            {uploading ? "Uploading..." : "Excel Upload"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleUpload}
          />
        </div>
      </div>

      {uploadResult && (
        <p className="text-sm -mt-3" style={{ color: "var(--muted)" }}>
          {uploadResult}
        </p>
      )}

      {!showForm && (
        <button onClick={() => setShowForm(true)} className="btn-primary w-fit">
          Add Product
        </button>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="card grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 animate-scale-in"
        >
          <h3 className="sm:col-span-3 text-sm font-semibold">
            {editingId ? "Edit Product" : "Add Product"}
          </h3>

          <div className="flex flex-col gap-1 sm:col-span-1">
            <label className="text-sm font-medium">Product name</label>
            <input
              className="input-field"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Gold Chain"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Ornament Type</label>
            <CustomSelect
              value={form.category}
              onChange={(v) =>
                setForm({ ...form, category: v as Product["category"] })
              }
              options={[
                { value: "Gold", label: "Gold" },
                { value: "Silver", label: "Silver" },
              ]}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Product Group</label>
            <input
              className="input-field"
              value={form.productGroup}
              onChange={(e) =>
                setForm({ ...form, productGroup: e.target.value })
              }
              placeholder="e.g. Ring"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Purity</label>
            <input
              className="input-field"
              value={form.purity}
              onChange={(e) => setForm({ ...form, purity: e.target.value })}
              placeholder="e.g. 22K"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Wastage tier 1 %</label>
            <input
              className="input-field"
              value={form.wastageTier1}
              onChange={(e) =>
                setForm({ ...form, wastageTier1: e.target.value })
              }
              placeholder="Add later"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Wastage tier 2 %</label>
            <input
              className="input-field"
              value={form.wastageTier2}
              onChange={(e) =>
                setForm({ ...form, wastageTier2: e.target.value })
              }
              placeholder="Add later"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Wastage tier 3 %</label>
            <input
              className="input-field"
              value={form.wastageTier3}
              onChange={(e) =>
                setForm({ ...form, wastageTier3: e.target.value })
              }
              placeholder="Add later"
            />
          </div>

          <div className="sm:col-span-3 flex gap-2">
            <button type="submit" className="btn-primary">
              {editingId ? "Save Changes" : "Add product"}
            </button>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead
            className="text-left"
            style={{ background: "var(--background)" }}
          >
            <tr>
              <th className="px-4 py-2">Ornament Type</th>
              <th className="px-4 py-2">Product Group</th>
              <th className="px-4 py-2">Product Name</th>
              <th className="px-4 py-2">Tier 1 WS</th>
              <th className="px-4 py-2">Tier 2 WS</th>
              <th className="px-4 py-2">Tier 3 WS</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!loading && filteredProducts.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-center"
                  style={{ color: "var(--muted)" }}
                >
                  No products found.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-center"
                  style={{ color: "var(--muted)" }}
                >
                  Loading...
                </td>
              </tr>
            )}
            {filteredProducts.map((p) => (
              <tr
                key={p.id}
                className="border-t table-row-hover transition-colors"
                style={{
                  borderColor: "var(--border)",
                  background:
                    editingId === p.id
                      ? "color-mix(in srgb, var(--primary) 8%, transparent)"
                      : undefined,
                }}
              >
                <td className="px-4 py-2">{p.category}</td>
                <td className="px-4 py-2">{p.product_group || "-"}</td>
                <td className="px-4 py-2">{p.name}</td>
                <td className="px-4 py-2">{p.wastage_tier_1 || "-"}</td>
                <td className="px-4 py-2">{p.wastage_tier_2 || "-"}</td>
                <td className="px-4 py-2">{p.wastage_tier_3 || "-"}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button
                    onClick={() => handleEdit(p)}
                    className="link-accent mr-3"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleRemove(p.id)}
                    className="link-danger"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
