((template_content) @injection.content
  (#set! injection.language "html")
  (#set! injection.combined))

((json_content) @injection.content
  (#set! injection.language "json")
  (#set! injection.combined))

((style_content) @injection.content
  (#set! injection.language "css")
  (#set! injection.combined))

((nazare_stylesheet_content) @injection.content
  (#set! injection.language "css"))

((nazare_script_statement
  language: (string) @script.language
  body: (nazare_script_content) @injection.content)
  (#match? @script.language "^['\"]ts['\"]$")
  (#set! injection.language "typescript"))

((nazare_script_statement
  language: (string) @script.language
  body: (nazare_script_content) @injection.content)
  (#match? @script.language "^['\"]js['\"]$")
  (#set! injection.language "javascript"))

((nazare_script_statement
  !language
  body: (nazare_script_content) @injection.content)
  (#set! injection.language "javascript"))

((js_content) @injection.content
  (#set! injection.language "javascript")
  (#set! injection.combined))

((front_matter) @injection.content
  (#set! injection.language "yaml"))
