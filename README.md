# simple-docs
A simple documentation tool based on markdown


## Features
1) Simple learning curve.
2) Less configuration. Focus on your content rather than tweaking the tools.
3) File/folder naming convention to order the links in the sidebar.
4) Generates HTML from markdown. 
5) Host the HTML files anywhere. This gives you flexibility in hosting.
6) Spend less time on tooling and more time on your content.



## Getting started

1) See the `/docs`, `/blog`, `/tutorial` directory for the structure.
2) Use the file/folder name convertion as below:
  `01-folder-name`
3) Inside the folders create the file names as below
   `01-getting-started.md`
    `02-basics.md`
4) The numbers `01`, `02` in the folder name and file name are used to order the links in the sidebar and also create the next and previouis links in the main content.
5) In the root directory run the command: `npm run build` to convert the markdown files to the HTML files in the `public` directory.
6) Host the generated `public` directory  anywhere.

