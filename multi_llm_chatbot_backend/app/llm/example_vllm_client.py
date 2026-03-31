# NEON AI (TM) SOFTWARE, Software Development Kit & Application Framework
# All trademark and other rights reserved by their respective owners
# Copyright 2008-2025 Neongecko.com Inc.

import re

from dataclasses import dataclass
from enum import IntEnum
from huggingface_hub import hf_hub_download
from huggingface_hub.utils import EntryNotFoundError
from brainforge_dataset_utils.config import ModelConfig

from openai import OpenAI, APIConnectionError



class OAuthProvider(IntEnum):
    NONE = 0
    GOOGLE = 1


@dataclass
class User:
    oauth: OAuthProvider
    username: str
    permissions_id: str

    @property
    def sanitized_username(self) -> str:
        """
        Get a filename and URL-safe representation of the username
        """
        return re.sub(r'[^a-z0-9]', '_', self.username.lower())


class Client:
    def __init__(self, api_url, api_key, personas=None, rag_enabled=False):
        self._rag_enabled = rag_enabled
        self.api_url = api_url
        self.api_key = api_key
        self.input_personas = personas or dict()
        self.openai = None
        self.vllm_model_name = None
        self.model_name = None
        self.revision = None
        self.personas = None
        self.config = None
        self.citations_supported = False

        self.init_all()

    def init_all(self):
        try:
            self.init_client()
            self.get_metadata()
            self.get_personas()
        except APIConnectionError:
            print(f"Init failed for client: {self.api_url}")

    def init_client(self):
        self.openai = OpenAI(
            base_url=f"{self.api_url}/v1",
            api_key=self.api_key,
        )

    def _init_config(self):
        if self.config is not None:
            # Config already initialized
            return
        config_path = hf_hub_download(self.model_name, "config.yaml",
                                      subfolder="datasets",
                                      revision=self.revision)
        self.config = ModelConfig.from_yaml(config_path)

    def get_metadata(self):
        models = self.openai.models.list()
        vllm_model_name = models.data[0].id

        model_name, *suffix = vllm_model_name.split("@")
        revision = dict(enumerate(suffix)).get(0, None)

        self.vllm_model_name = vllm_model_name
        self.model_name = model_name
        self.revision = revision

        self._init_config()
        if "mistral-small-24b" in self.config.train.base_model.lower():
            self.citations_supported = True

    def get_personas(self):
        personas = {}
        if self.revision is not None:
            try:
                self._init_config()
                personas = self.config.pile.persona2system
            except EntryNotFoundError:
                pass

        personas["vanilla"] = None
        if self._rag_enabled:
            personas["RAG"] = None
        self.personas = self.input_personas | personas