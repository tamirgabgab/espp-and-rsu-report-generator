"""Unit tests for tools/update_rates.py (no network). Run: python3 -m unittest discover -s tests -p "test_*.py"."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
import update_rates as ur  # noqa: E402


class CheckBoiHistory(unittest.TestCase):
    OLD = {"2024-01-01": 3.6, "2024-01-02": 3.61, "2024-01-03": 3.62}

    def test_first_run_accepts_any_valid_history(self):
        self.assertEqual(ur.check_boi_history({}, self.OLD), [])

    def test_appended_dates_are_fine(self):
        self.assertEqual(ur.check_boi_history(self.OLD, {**self.OLD, "2024-01-04": 3.63}), [])

    def test_shrunk_history_is_refused(self):
        with self.assertRaises(RuntimeError):
            ur.check_boi_history(self.OLD, {"2024-01-02": 3.61, "2024-01-03": 3.62})

    def test_missing_date_is_refused(self):
        new = {"2024-01-01": 3.6, "2024-01-03": 3.62, "2024-01-04": 3.63}
        with self.assertRaises(RuntimeError):
            ur.check_boi_history(self.OLD, new)

    def test_out_of_range_rate_is_refused(self):
        with self.assertRaises(RuntimeError):
            ur.check_boi_history(self.OLD, {**self.OLD, "2024-01-04": 36.3})

    def test_changed_value_is_reported(self):
        lines = ur.check_boi_history(self.OLD, {**self.OLD, "2024-01-02": 3.7})
        self.assertEqual(lines, ["2024-01-02: 3.61 -> 3.7"])



class JsDataFileTest(unittest.TestCase):
    def test_round_trip_one_date_per_line(self):
        import tempfile
        payload = {"source": "x", "rates": {"2024-01-02": 3.61, "2024-01-03": 3.62}, "high": {}}
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d) / "x.js"
            ur.write_js(path, "X_DATA", payload)
            text = path.read_text(encoding="utf-8")
            self.assertIn('\n"2024-01-03":3.62\n', text)
            self.assertEqual(ur.read_js(path, "X_DATA"), payload)
            self.assertIsNone(ur.read_js(pathlib.Path(d) / "missing.js", "X_DATA"))

if __name__ == "__main__":
    unittest.main()
