import sys
from pathlib import Path
from types import SimpleNamespace
import unittest

import httpx

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from fourshort_worker.errors import JobError
from fourshort_worker.providers import DeepSeekLlm, OpenRouterLlm


class FailingClient:
    def post(self, *_args, **_kwargs):
        raise httpx.ReadTimeout("simulated provider timeout")


class ProviderFailureTests(unittest.TestCase):
    def test_openrouter_timeout_becomes_retryable_job_error(self):
        provider = OpenRouterLlm(SimpleNamespace(
            openrouter_api_key="test-key",
            openrouter_base_url="https://openrouter.example.invalid",
            control_api_url="https://api.example.invalid",
            allowed_llm_models={"deepseek/deepseek-v4-flash"},
            blocked_llm_prefixes=(),
        ))
        provider.client = FailingClient()

        with self.assertRaises(JobError) as context:
            provider.complete_json("deepseek/deepseek-v4-flash", "system", "prompt")

        self.assertEqual(context.exception.code, "LLM_PROVIDER_UNAVAILABLE")
        self.assertTrue(context.exception.retryable)

    def test_deepseek_timeout_becomes_retryable_job_error(self):
        provider = DeepSeekLlm(SimpleNamespace(
            deepseek_api_key="test-key",
            deepseek_base_url="https://deepseek.example.invalid",
        ))
        provider.client = FailingClient()

        with self.assertRaises(JobError) as context:
            provider.complete_json("deepseek/deepseek-v4-flash", "system", "prompt")

        self.assertEqual(context.exception.code, "LLM_PROVIDER_UNAVAILABLE")
        self.assertTrue(context.exception.retryable)


if __name__ == "__main__":
    unittest.main()
