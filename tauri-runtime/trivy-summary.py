#!/usr/bin/env python3
"""Group raw Trivy findings by CVE without suppressing or reclassifying any finding."""
import argparse
import collections
import json
from pathlib import Path


def summarize(report: dict) -> dict:
    unique = {}
    by_package = collections.Counter()
    package_types = collections.defaultdict(set)
    severity = collections.Counter()
    fixed = collections.Counter()
    findings = 0
    for result in report.get("Results", []):
        target = str(result.get("Target", "unknown"))
        result_type = str(result.get("Type", "unknown"))
        for issue in result.get("Vulnerabilities") or []:
            if issue.get("Severity") not in ("HIGH", "CRITICAL"):
                continue
            findings += 1
            vuln_id = str(issue.get("VulnerabilityID", "UNKNOWN"))
            pkg = str(issue.get("PkgName", "UNKNOWN"))
            sev = str(issue["Severity"])
            by_package[pkg] += 1
            package_types[pkg].add(result_type)
            severity[sev] += 1
            key = vuln_id
            if key not in unique:
                unique[key] = {
                    "id": vuln_id, "severity": sev, "packages": set(),
                    "targets": set(), "fix_available": False,
                    "statuses": set(), "installed_versions": set(),
                }
            entry = unique[key]
            if sev == "CRITICAL":
                entry["severity"] = "CRITICAL"
            entry["packages"].add(pkg)
            entry["targets"].add(target)
            if issue.get("FixedVersion"):
                entry["fix_available"] = True
            if issue.get("Status"):
                entry["statuses"].add(str(issue["Status"]))
            if issue.get("InstalledVersion"):
                entry["installed_versions"].add(str(issue["InstalledVersion"]))
    cves = []
    for entry in unique.values():
        cves.append({
            **entry,
            "packages": sorted(entry["packages"]),
            "targets": sorted(entry["targets"]),
            "statuses": sorted(entry["statuses"]),
            "installed_versions": sorted(entry["installed_versions"]),
        })
    cves.sort(key=lambda x: (x["severity"] != "CRITICAL", not x["fix_available"], x["id"]))
    return {
        "reported_findings": findings,
        "distinct_cves": len(cves),
        "severity_findings": dict(severity),
        "cves_with_reported_fix": sum(c["fix_available"] for c in cves),
        "cves_without_reported_fix": sum(not c["fix_available"] for c in cves),
        "package_findings": [
            {"package": p, "findings": n, "scan_types": sorted(package_types[p])}
            for p, n in by_package.most_common()
        ],
        "cves": cves,
    }


def to_markdown(summary: dict) -> str:
    lines = [
        "# Tauri image vulnerability triage (raw Trivy evidence)",
        "",
        f"Reported HIGH/CRITICAL findings: **{summary['reported_findings']}**.",
        f"Distinct CVE identifiers: **{summary['distinct_cves']}**.",
        f"Distinct CVEs with a Trivy-reported fix: **{summary['cves_with_reported_fix']}**.",
        f"Distinct CVEs without a Trivy-reported fix: **{summary['cves_without_reported_fix']}**.",
        "",
        "A missing FixedVersion does not prove no upstream patch exists. "
        "Duplicates across related binary packages are reported, not ignored. "
        "This report does NOT change the blocking Trivy result.",
        "",
        "## Top affected packages",
        "",
        "| Package | HIGH/CRITICAL entries | Scanner type |",
        "| --- | ---: | --- |",
    ]
    for row in summary["package_findings"][:30]:
        lines.append(f"| `{row['package']}` | {row['findings']} | {', '.join(row['scan_types'])} |")
    lines += ["", "## Distinct CVEs (critical first, reported fixes first)", "",
              "| CVE | Severity | Fix reported | Package count | Status |",
              "| --- | --- | --- | ---: | --- |"]
    for cve in summary["cves"]:
        lines.append(
            f"| {cve['id']} | {cve['severity']} | {'Yes' if cve['fix_available'] else 'No'} | "
            f"{len(cve['packages'])} | {', '.join(cve['statuses'])} |"
        )
    lines += ["", "See the JSON report for package/target/version details and the raw Trivy JSON for full evidence.", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--json", type=Path, required=True)
    parser.add_argument("--markdown", type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.report.read_text(encoding="utf-8"))
    result = summarize(data)
    args.json.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    args.markdown.write_text(to_markdown(result), encoding="utf-8")
    print(f"Trivy triage: {result['reported_findings']} findings, {result['distinct_cves']} distinct CVEs; "
          f"{result['cves_with_reported_fix']} distinct CVEs report a fixed version")


if __name__ == "__main__":
    main()
