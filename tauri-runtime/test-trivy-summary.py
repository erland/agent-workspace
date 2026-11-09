#!/usr/bin/env python3
"""Small self-contained fixture tests run before the expensive Tauri image build."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("triage", Path(__file__).with_name("trivy-summary.py"))
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TrivySummaryTests(unittest.TestCase):
    def test_groups_duplicate_cves_but_keeps_all_evidence(self):
        fixture = {"Results": [
            {"Target": "debian", "Type": "debian", "Vulnerabilities": [
                {"VulnerabilityID": "CVE-2026-1", "PkgName": "libsoup-3.0-0",
                 "Severity": "CRITICAL", "Status": "affected", "InstalledVersion": "1"},
                {"VulnerabilityID": "CVE-2026-1", "PkgName": "libsoup-3.0-dev",
                 "Severity": "CRITICAL", "Status": "affected", "InstalledVersion": "1"},
                {"VulnerabilityID": "CVE-2026-2", "PkgName": "libxml2",
                 "Severity": "HIGH", "FixedVersion": "2.0"},
                {"VulnerabilityID": "CVE-2026-3", "PkgName": "irrelevant",
                 "Severity": "LOW"},
            ]}
        ]}
        summary = module.summarize(fixture)
        self.assertEqual(summary["reported_findings"], 3)
        self.assertEqual(summary["distinct_cves"], 2)
        self.assertEqual(summary["cves_with_reported_fix"], 1)
        self.assertEqual(summary["cves_without_reported_fix"], 1)
        self.assertEqual(summary["cves"][0]["id"], "CVE-2026-1")
        self.assertEqual(len(summary["cves"][0]["packages"]), 2)
        self.assertIn("This report does NOT change", module.to_markdown(summary))

    def test_empty_report(self):
        summary = module.summarize({"Results": []})
        self.assertEqual(summary["distinct_cves"], 0)
        self.assertEqual(summary["reported_findings"], 0)
        self.assertIn("0", module.to_markdown(summary))


if __name__ == "__main__":
    unittest.main()
