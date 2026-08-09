import { createTheme, type MantineColorsTuple } from "@mantine/core";

const brand: MantineColorsTuple = [
  "#f6ecff",
  "#e8d2ff",
  "#d3a7ff",
  "#bd79ff",
  "#aa53fe",
  "#a13cfe",
  "#9c2ffe",
  "#8821e3",
  "#7919cb",
  "#680fb2",
];

export const theme = createTheme({
  primaryColor: "brand",
  colors: { brand },
  fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
  defaultRadius: "sm",
  headings: { fontWeight: "600" },
});
