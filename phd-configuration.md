## Background

	\- Using the current \[PhD Advisory Panel\](https://phd-frontend.web.app/) for reference, this document outlines some suggestions for how to make the application configurable to support alternative applications. This broadly starts from a naiive user's perspective looking at the website and continues to include suggestions relating to the backend. Many of these suggestions are opinionated and design choices may make them more or less important.

	\- The UI changes should be relatively trivial, though there may be some assumptions in the back-end code that need to be addressed, such as assuming the number of personas, length of lists, length of text, etc. Think about how to sanitize configuration inputs, but also bear in mind that documentation can be used to explain limitations; this is not user-facing, it is developer-facing.

## UI Changes

	\- \#\#\# Homepage

			\- The tab title and header title should use a single configured value

			\- The subtitle in the header should be configurable

			\- The headline and text on the home page ("Get Guidance from Advisor Personas" ...) should be configurable

					\- Consider leaving "Get Guidance from" as hard-coded and configuring only the value that is displayed in the primary color

			\- The primary color (currently purple/lavender) should be configurable

					\- Think about color names, RGB, RGBA, HSL values.. All are valid, just need to document which system is used

			\- The personas should be configurable

					\- Consider a single "base prompt" template and multiple "persona prompt" templates, so that each persona prompt only needs to contain unique information and not boilerplate prompting about how to format responses

					\- Consider a list of supported icons and colors for each persona to choose from

					\- Consider keeping personas to a name and subtitle, rather than 3 lines which is more to configure

	\- \#\#\# Login Page

			\- On the login screen, the subtitle "Sign in to continue your PhD research journey" should be configurable

	\- \#\#\# Default Chat Page

			\- The header should use the same configured params as on the home page

			\- The sections and example prompts should be configurable

					\- Consider a list of sections, each with a list of prompts so to more easily extend to include more sections/prompts

			\- The prompt text in the text box should be configurable

## Backend Configuration Changes

	\- Consider moving token settings to configuration

	\- Make keywords configurable

			\- I am personally not sure what the intent is here; these may be persona-oriented which would require some further consideration

			\- Out of scope, but a lot of this may be better handled by a static language parser (or even an LLM prompt), rather than hard-coded keywords

	\- Consider moving mongodb settings to configuration

	\- Consider EmailService configuration

			\- Also, keep in mind that a production system may need to use a service like SendGrid, if you scale beyond a few dozen users

	\- Consider RAG configuration

			\- Also, consider splitting this from the main project and simply configuring an MCP server endpoint in this application

	\- Consider Orchestrator configuration

			\- I am unsure how the required\_fields are used, but they may make sense to be configurable

			\- Research area and academic stage likewise are very application-specific and may not easily translate to configuration

			\- Consider if orchestrators are/should be domain-specific and if so, how could the project allow for using different orchestrators for different kinds of applications

			\- Also, consider if a language model might better determine some of the information being extracted via keywords

	\- API Keys

	\- Related to persona config, the \`models\` module will need to be refactored

	\- Note that there is already a \`config\` module; it is empty. I like using Pydantic objects to validate configuration and specify default values. Pydantic validators also allow for modifying configuration structure in the future while supporting backwards-compat. with validator methods and aliases. In this case, a validator could allow for falling back to the currently used envvars if configuration didn't specify parameters like API keys and the JWT secret.

## Example Configuration

    colors:

      primary: purple  \# Hex values or interpreted color names?

    title\_bar:

      title: PhD Advisory

      subtitle: AI-Powered Academic Guidance

    homepage:

      headline: Get Guidance from Advisor Personas

      login\_prompt: Sign in to continue your PhD research journey

    chat\_page:

      examples:

        \- Orientation & Guidance:

          \- "How do I choose a research topic that's interesting and doable?"

          \- ...

        \- ...:

      placeholder\_text: Ask your advisors anything about your PhD journey...

    personas:

      \- name: Pragmatist

        summary: Real-world & Outcome-focused

        color: green

        icon: concentric-circles  \# If these are currently bundled assets, consider using something like FontAwesome to support more options

        persona\_prompt: "You are a pragmatic academic advisor"

    auth\_tokens:

      secret: your-secret-key-change-this-in-production

      algo: HS256

      expiration\_minutes: 43200  \# 30 days

    mongodb:

      connection\_string: ""  \# Consider also accepting separate fields for address, port, username, and password

      database\_name: phd\_advisor

    email:

      server: smtp.gmail.com

      port: 587

      username: ""

      password: ""

      from\_email: \# Consider None vs empty string

      app\_name:  \# Consider None vs empty string

    rag:

      embedding\_model: all-MiniLM-L6-v2

      chroma\_collection: phd\_advisor\_documents

    llm:

      gemini:

        api\_key: ""

        model: ""

      ollama:

        model: ""

        base\_url: ""

      

## Reformatted example configuration to non-tech user friendly: 

###     **colors**:

      **primary:** purple  *\# use hex values to specify exact colors*

###     **title\_bar**:

      **title**: PhD Advisory

      **subtitle**: AI-Powered Academic Guidance

###     **homepage**:

      **headline**: Get Guidance from Advisor Personas

      **login\_prompt**: Sign in to continue your PhD research journey

###     **chat\_page**:

      **examples**:

        **\- Orientation & Guidance**:

          \- "How do I choose a research topic that's interesting and doable?"

          \- ...

        \- ...:

      **placeholder\_text**: Ask your advisors anything about your PhD journey...

###     **personas**:

      \- **name**: Pragmatist

        **summary**: Real-world & Outcome-focused

        **color**: green

        **icon**: concentric-circles 

        **persona\_prompt**: "You are a pragmatic academic advisor"

###     **auth\_tokens**:

      **secret**: your-secret-key-change-this-in-production

      **algo**: HS256

      **expiration\_minutes**: 43200  \# 30 days

###     **mongodb**:

      **connection\_string**: ""  \# Consider also accepting separate fields for address, port, username, and password

      **database\_name**: phd\_advisor

###     **email**:

      **server**: smtp.gmail.com

      **port**: 587

      **username**: ""

      **password**: ""

      **from\_email**: \# Consider None vs empty string

      **app\_name**:  \# Consider None vs empty string

###     **rag**:

      **embedding\_model**: all-MiniLM-L6-v2

      **chroma\_collection**: phd\_advisor\_documents

###     **llm**:

      **gemini**:

        **api\_key**: ""

        **model**: ""

      **ollama**:

        **model**: ""

        **base\_url**: ""