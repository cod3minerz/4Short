import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.errors import JobError
from fourshort_worker.provider_policy import validate_llm_model


class ProviderPolicyTests(unittest.TestCase):
    def setUp(self):
        self.allowed = {
            "deepseek/deepseek-v4-flash",
            "deepseek/deepseek-v4-pro",
            "openrouter/auto",
            "openai/gpt-example",
            "anthropic/claude-example",
        }
        self.blocked = ("openai/", "anthropic/")

    def test_explicit_allowed_model_passes(self):
        validate_llm_model("deepseek/deepseek-v4-flash", self.allowed, self.blocked)

    def test_auto_and_prohibited_families_are_rejected_even_if_misconfigured(self):
        for model in ("openrouter/auto", "openai/gpt-example", "anthropic/claude-example"):
            with self.subTest(model=model):
                with self.assertRaises(JobError):
                    validate_llm_model(model, self.allowed, self.blocked)

    def test_unknown_model_is_rejected(self):
        with self.assertRaises(JobError):
            validate_llm_model("qwen/unreviewed", self.allowed, self.blocked)


if __name__ == "__main__":
    unittest.main()
