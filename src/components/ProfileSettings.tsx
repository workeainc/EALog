import { useEffect, useState, type FormEvent } from "react";
import { Building2, RotateCcw, Save, UserRound } from "lucide-react";
import type { TrackerProfile } from "../types/tracker";

type Props = {
    profile: TrackerProfile | null;
    authName: string;
    onSave: (profile: Partial<TrackerProfile>) => Promise<void>;
};

type FormState = Pick<
    TrackerProfile,
    | "displayName"
    | "designation"
    | "companyName"
    | "reportFooter"
    | "signatureLabel"
    | "logoUrl"
>;

const blank = (authName: string): FormState => ({
    displayName: authName,
    designation: "",
    companyName: "",
    reportFooter: "",
    signatureLabel: "",
    logoUrl: "",
});

export default function ProfileSettings({ profile, authName, onSave }: Props) {
    const [form, setForm] = useState<FormState>(() => ({
        ...blank(authName),
        ...profile,
    }));
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        setForm({ ...blank(authName), ...profile });
    }, [profile, authName]);

    const update = (key: keyof FormState, value: string) =>
        setForm((current) => ({ ...current, [key]: value }));

    const save = async (event: FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        setMessage("");
        try {
            await onSave(form);
            setMessage("Profile and report branding saved.");
        } catch (cause: any) {
            setError(cause?.message || "Could not save your profile.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="profile-settings">
            <div className="settings-heading">
                <div>
                    <span className="eyebrow">PRIVATE SETTINGS</span>
                    <h2>Professional profile</h2>
                    <p className="muted">
                        These details appear on PDFs you generate. They stay in
                        your private workspace.
                    </p>
                </div>
                <div
                    className="settings-profile-preview"
                    aria-label="Profile preview"
                >
                    <div className="avatar">
                        {(form.displayName || authName || "A")
                            .split(/\s+/)
                            .map((part) => part[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                    </div>
                    <div>
                        <b>{form.displayName || authName || "Your name"}</b>
                        <small>{form.designation || "Your designation"}</small>
                    </div>
                </div>
            </div>

            <form className="settings-form" onSubmit={save}>
                <div className="settings-section-title">
                    <UserRound size={17} /> Identity
                </div>
                <div className="settings-fields">
                    <label htmlFor="profile-display-name">
                        Display name
                        <input
                            id="profile-display-name"
                            name="displayName"
                            maxLength={80}
                            value={form.displayName}
                            onChange={(event) =>
                                update("displayName", event.target.value)
                            }
                            placeholder="e.g. Admin Rahman"
                        />
                    </label>
                    <label htmlFor="profile-designation">
                        Designation
                        <input
                            id="profile-designation"
                            name="designation"
                            maxLength={100}
                            value={form.designation}
                            onChange={(event) =>
                                update("designation", event.target.value)
                            }
                            placeholder="e.g. Senior Developer"
                        />
                    </label>
                </div>
                <button
                    className="text-btn reset-name"
                    type="button"
                    onClick={() => update("displayName", authName)}
                >
                    <RotateCcw size={14} /> Use Google account name
                </button>

                <div className="settings-section-title">
                    <Building2 size={17} /> Report branding
                </div>
                <div className="settings-fields">
                    <label htmlFor="profile-company-name">
                        Company / client
                        <input
                            id="profile-company-name"
                            name="companyName"
                            maxLength={120}
                            value={form.companyName}
                            onChange={(event) =>
                                update("companyName", event.target.value)
                            }
                            placeholder="e.g. EA Incorporation"
                        />
                    </label>
                    <label htmlFor="profile-signature-label">
                        Signature label
                        <input
                            id="profile-signature-label"
                            name="signatureLabel"
                            maxLength={80}
                            value={form.signatureLabel}
                            onChange={(event) =>
                                update("signatureLabel", event.target.value)
                            }
                            placeholder="e.g. Management signature"
                        />
                    </label>
                    <label htmlFor="profile-logo-url">
                        Logo URL <span>(optional)</span>
                        <input
                            id="profile-logo-url"
                            name="logoUrl"
                            type="url"
                            inputMode="url"
                            maxLength={500}
                            value={form.logoUrl}
                            onChange={(event) =>
                                update("logoUrl", event.target.value)
                            }
                            placeholder="https://example.com/logo.png"
                        />
                    </label>
                    <label
                        className="settings-wide"
                        htmlFor="profile-report-footer"
                    >
                        Report footer
                        <textarea
                            id="profile-report-footer"
                            name="reportFooter"
                            maxLength={240}
                            value={form.reportFooter}
                            onChange={(event) =>
                                update("reportFooter", event.target.value)
                            }
                            placeholder="e.g. Prepared for weekly management review."
                        />
                    </label>
                </div>
                <p className="settings-help">
                    Use plain text only. Logo URLs must use HTTPS; logos are
                    stored for future header support and are not embedded in
                    PDFs yet.
                </p>
                {error && <p className="sync-warning">{error}</p>}
                {message && <p className="settings-success">{message}</p>}
                <div className="settings-actions">
                    <button
                        className="start-btn"
                        type="submit"
                        disabled={saving}
                    >
                        <Save size={16} /> {saving ? "Saving…" : "Save profile"}
                    </button>
                </div>
            </form>
        </section>
    );
}
