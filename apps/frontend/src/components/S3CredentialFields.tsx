import { PasswordInput, TextInput } from "@mantine/core";
import { useLanguage } from "../i18n/LanguageContext";

export interface S3FieldsValue {
  bucket: string;
  region: string;
  prefix: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const EMPTY_S3_FIELDS: S3FieldsValue = {
  bucket: "",
  region: "us-east-1",
  prefix: "",
  endpoint: "",
  accessKeyId: "",
  secretAccessKey: "",
};

export function isS3FieldsComplete(value: S3FieldsValue): boolean {
  return value.bucket.trim().length > 0 && value.region.trim().length > 0 &&
    value.accessKeyId.length > 0 && value.secretAccessKey.length > 0;
}

interface S3CredentialFieldsProps {
  value: S3FieldsValue;
  onChange: (patch: Partial<S3FieldsValue>) => void;
}

// The bucket/region/subfolder/endpoint/access key/secret fields shared by the S3 connect form
// (LibrariesSettings.tsx) and the migration wizard (MigrationWizard.tsx) - pulled out so both stay
// in sync rather than maintaining two copies of the same six inputs.
export function S3CredentialFields({ value, onChange }: S3CredentialFieldsProps) {
  const { t } = useLanguage();

  return (
    <>
      <TextInput
        label={t("librariesSettings.s3Bucket")}
        value={value.bucket}
        onChange={(e) => onChange({ bucket: e.currentTarget.value })}
      />
      <TextInput
        label={t("librariesSettings.s3Region")}
        value={value.region}
        onChange={(e) => onChange({ region: e.currentTarget.value })}
      />
      <TextInput
        label={t("librariesSettings.s3Prefix")}
        placeholder={t("librariesSettings.s3PrefixPlaceholder")}
        value={value.prefix}
        onChange={(e) => onChange({ prefix: e.currentTarget.value })}
      />
      <TextInput
        label={t("librariesSettings.s3Endpoint")}
        description={t("librariesSettings.s3EndpointDescription")}
        placeholder={t("librariesSettings.s3EndpointPlaceholder")}
        value={value.endpoint}
        onChange={(e) => onChange({ endpoint: e.currentTarget.value })}
      />
      <TextInput
        label={t("librariesSettings.s3AccessKey")}
        value={value.accessKeyId}
        onChange={(e) => onChange({ accessKeyId: e.currentTarget.value })}
      />
      <PasswordInput
        label={t("librariesSettings.s3SecretKey")}
        value={value.secretAccessKey}
        onChange={(e) => onChange({ secretAccessKey: e.currentTarget.value })}
      />
    </>
  );
}
