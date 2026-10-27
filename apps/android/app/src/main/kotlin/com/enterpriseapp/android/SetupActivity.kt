package com.enterpriseapp.android

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.github.marinoscar.platform.android.core.PlatformIdentity
import io.github.marinoscar.platform.android.core.config.ServerConfig
import io.github.marinoscar.platform.android.core.config.ServerUrlResult

/**
 * First-run screen: asks for the server address (validated by the platform's `ServerUrls`:
 * https only, an origin without a path), saves it in `ServerConfig`, then opens the web app.
 * Plain framework views on purpose: the shell has no UI toolkit dependency.
 */
class SetupActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = ServerConfig.from(this)
        val padding = (24 * resources.displayMetrics.density).toInt()

        val title = TextView(this).apply {
            text = "Welcome to ${PlatformIdentity.productName}"
            textSize = 24f
        }
        val help = TextView(this).apply {
            text = "Enter the address of your ${PlatformIdentity.productName} server. " +
                "It is the same address you open in the browser."
            textSize = 16f
            setPadding(0, padding / 2, 0, padding / 2)
        }
        val input = EditText(this).apply {
            hint = "https://app.example.com"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            isSingleLine = true
            setText(config.serverUrl.orEmpty())
        }
        val error = TextView(this).apply {
            setTextColor(0xFFB00020.toInt())
            setPadding(0, padding / 4, 0, padding / 4)
        }
        val save = Button(this).apply { text = "Save and open" }

        fun submit() {
            when (val result = config.setServerUrl(input.text.toString())) {
                is ServerUrlResult.Valid -> {
                    startActivity(
                        Intent(this, TwaLauncherActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
                    )
                    finish()
                }
                is ServerUrlResult.Invalid -> error.text = result.reason
            }
        }
        save.setOnClickListener { submit() }
        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                submit()
                true
            } else {
                false
            }
        }

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.TOP
            setPadding(padding, padding, padding, padding)
            addView(title)
            addView(help)
            addView(input)
            addView(error)
            addView(save)
        }
        setContentView(ScrollView(this).apply { addView(column) })
    }
}
