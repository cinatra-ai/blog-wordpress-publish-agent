import { createElement } from "react";
export function Button({ variant, ...props }) { return createElement("button", props); }
export function Card(props) { return createElement("section", props); }
export function CardContent(props) { return createElement("div", props); }
export function CardFooter(props) { return createElement("footer", props); }
export function CardHeader(props) { return createElement("header", props); }
export function CardTitle(props) { return createElement("h2", props); }
