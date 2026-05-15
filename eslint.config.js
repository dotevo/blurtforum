const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "script",
            globals: {
                ...globals.browser,
                ...globals.node,
                Vue: "readonly",
                dblurt: "readonly",
                TR: "readonly",
                whalevault: "readonly",
                confirm: "readonly",
                marked: "readonly",
                DOMPurify: "readonly",
                CryptoJS: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error",
            "no-redeclare": "off"
        }
    }
];
