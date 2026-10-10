# R8 rules applied to every app that includes :platform-core.

# --- kotlinx.serialization ---------------------------------------------------
# Keep the generated serializers of the module's own @Serializable classes.
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-keepclassmembers @kotlinx.serialization.Serializable class io.github.marinoscar.platform.android.core.** {
    *** Companion;
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class io.github.marinoscar.platform.android.core.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class io.github.marinoscar.platform.android.core.**$$serializer { *; }

# --- OkHttp ------------------------------------------------------------------
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# --- androidbrowserhelper ----------------------------------------------------
-dontwarn com.google.androidbrowserhelper.**

# --- security-crypto (Tink) --------------------------------------------------
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
